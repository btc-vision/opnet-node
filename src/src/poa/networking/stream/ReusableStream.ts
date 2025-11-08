import { PeerId, Stream, StreamCloseEvent, StreamMessageEvent } from '@libp2p/interface';
import { Uint8ArrayList } from 'uint8arraylist';

/**
 * Options for controlling stream behavior
 */
interface ReusableStreamOptions {
    /** If > 0, auto-close stream after this many ms of no outbound writes */
    idleTimeoutMs: number;
    /** Maximum length of a single message we allow */
    maxMessageSize: number;
    /** How long to wait for an ack if `waitForAck=true` */
    ackTimeoutMs: number;
    /** Whether the sender expects an ack for each outbound message */
    waitForAck: boolean;
    /** True if stream originated inbound (remote dialed us) */
    isInbound: boolean;
}

/**
 * A single stream that can handle both inbound and outbound operations.
 *
 * Uses the MessageStream API directly. The key insight is that MessageStream
 * already handles message framing - each send() results in one message event.
 * No manual length-prefixing is needed.
 */
export class ReusableStream {
    private isClosed = false;

    /** Limit how many outbound messages we queue at once */
    private readonly MAX_QUEUE_SIZE = 100;

    private messageQueue: Array<{
        data: Uint8Array;
        resolve: () => void;
        reject: (err: unknown) => void;
    }> = [];

    /** Guard so only one `processQueue()` runs at once */
    private _isProcessingQueue = false;

    private idleTimer: NodeJS.Timeout | undefined;

    /**
     * For `waitForAck = true`, each outbound message has a "waiter" that gets resolved
     * when `[0x01]` arrives. The read loop checks for `[0x01]`.
     */
    private ackWaiters: Array<{
        resolve: () => void;
        reject: (err: unknown) => void;
        timer: NodeJS.Timeout;
    }> = [];

    private readonly messageHandler: ((event: StreamMessageEvent) => void) | undefined;
    private readonly closeHandler: ((event: StreamCloseEvent) => void) | undefined;

    constructor(
        public readonly peerId: PeerId,
        public readonly protocol: string,
        private readonly libp2pStream: Stream,
        private readonly opts: ReusableStreamOptions,
        /**
         * A unique ID for this stream (used by the manager to remove from maps)
         */
        private readonly id: string,
        /**
         * Callback when the stream is closed
         */
        private readonly onClose: (key: string) => void,
        /**
         * Called for any inbound data if `isInbound = true`
         */
        private readonly onInboundData?: (data: Uint8Array, rs: ReusableStream) => Promise<void>,
    ) {
        // Set up event listeners for the MessageStream interface
        this.messageHandler = (event: StreamMessageEvent) => {
            void this.handleMessage(event.data);
        };

        this.closeHandler = (_event: StreamCloseEvent) => {
            void this.closeStream();
        };

        this.libp2pStream.addEventListener('message', this.messageHandler);
        this.libp2pStream.addEventListener('close', this.closeHandler);
    }

    public get peerIdStr(): string {
        return this.peerId.toString();
    }

    /**
     * Enqueues a message to send. We do a FIFO queue to avoid concurrency issues.
     */
    public sendMessage(data: Uint8Array): Promise<void> {
        if (this.isClosed) {
            return Promise.reject(new Error(`Stream to peer ${this.peerIdStr} is closed.`));
        }

        if (this.messageQueue.length >= this.MAX_QUEUE_SIZE) {
            return Promise.reject(
                new Error(
                    `Outbound queue is full (max: ${this.MAX_QUEUE_SIZE}) for ${this.peerIdStr}`,
                ),
            );
        }

        return new Promise<void>((resolve, reject) => {
            this.messageQueue.push({ data, resolve, reject });

            if (this.messageQueue.length === 1 && !this._isProcessingQueue) {
                void this.processQueue();
            }
        });
    }

    /**
     * Close the stream, cancelling any queued messages and ack waiters.
     */
    public async closeStream(): Promise<void> {
        if (this.isClosed) return;
        this.isClosed = true;

        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = undefined;
        }

        // Remove event listeners
        if (this.messageHandler) {
            this.libp2pStream.removeEventListener('message', this.messageHandler);
        }

        if (this.closeHandler) {
            this.libp2pStream.removeEventListener('close', this.closeHandler);
        }

        try {
            await this.libp2pStream.close();
        } catch (err) {
            console.warn(`Error closing stream for ${this.peerIdStr}:`, err);
        } finally {
            // Inform manager
            this.onClose(this.id);

            // Reject any outbound messages still waiting
            for (const { reject } of this.messageQueue) {
                reject(new Error('Stream closed before message was processed.'));
            }

            this.messageQueue = [];

            // Reject any ack waiters
            for (const w of this.ackWaiters) {
                clearTimeout(w.timer);
                w.reject(new Error('Stream closed before ack was received.'));
            }
            this.ackWaiters = [];
        }
    }

    /**
     * Handle incoming messages from the stream
     */
    private async handleMessage(data: Uint8Array | Uint8ArrayList): Promise<void> {
        try {
            const bytes = data instanceof Uint8Array ? data : data.subarray();
            console.log('Received message', bytes);

            // If data is exactly [0x01], treat as ack
            if (bytes.length === 1 && bytes[0] === 0x01) {
                const w = this.ackWaiters.shift();
                if (w) {
                    clearTimeout(w.timer);
                    w.resolve();
                }
                return;
            }

            // Otherwise, this is a real message. We always ack it:
            this.sendAck();

            // If inbound, pass data along
            if (this.opts.isInbound && this.onInboundData) {
                await this.onInboundData(bytes, this);
            }
        } catch (err) {
            console.error(`Error handling message for ${this.peerIdStr}:`, err);
        }
    }

    /**
     * Sends a single byte [0x01] as an ack to the remote.
     */
    private sendAck(): void {
        this.libp2pStream.send(Uint8Array.of(0x01));
    }

    /**
     * Process outbound messages in FIFO, sending each in turn.
     */
    private async processQueue(): Promise<void> {
        this._isProcessingQueue = true;

        while (this.messageQueue.length > 0 && !this.isClosed) {
            const { data, resolve, reject } = this.messageQueue[0];
            try {
                await this.writeData(data);
                resolve();
            } catch (err) {
                reject(err);
            } finally {
                this.messageQueue.shift();
            }
        }

        this._isProcessingQueue = false;
    }

    /**
     * Actually writes the data. MessageStream handles message framing.
     */
    private async writeData(data: Uint8Array): Promise<void> {
        this.resetIdleTimer();

        // Send the data directly - MessageStream handles framing
        this.libp2pStream.send(data);

        // Wait for drain if needed
        if (this.libp2pStream.writableNeedsDrain) {
            await this.libp2pStream.onDrain();
        }
    }

    /**
     * Reset idle timer after a successful send. If no sends happen for `idleTimeoutMs`, close.
     */
    private resetIdleTimer(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }
        if (this.opts.idleTimeoutMs > 0) {
            this.idleTimer = setTimeout(() => {
                void this.closeStream();
            }, this.opts.idleTimeoutMs);
        }
    }
}
