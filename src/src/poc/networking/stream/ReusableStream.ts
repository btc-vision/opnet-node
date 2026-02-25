import { PeerId, Stream, StreamCloseEvent, StreamMessageEvent } from '@libp2p/interface';
import { Uint8ArrayList } from 'uint8arraylist';
import { Logger } from '@btc-vision/bsi-common';

/**
 * Options for controlling stream behavior
 */
interface ReusableStreamOptions {
    /** If > 0, auto-close stream after this many ms of no outbound writes */
    idleTimeoutMs: number;
    /** Maximum length of a single message we allow */
    maxMessageSize: number;
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
export class ReusableStream extends Logger {
    public readonly logColor: string = '#ff9933';

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

    private readonly messageHandler: ((event: StreamMessageEvent) => void) | undefined;
    private readonly closeHandler: ((event: StreamCloseEvent) => void) | undefined;

    private outboundMessageCount = 0;
    private inboundMessageCount = 0;
    private ackReceivedCount = 0;
    private ackSentCount = 0;

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
        super();

        const direction = opts.isInbound ? 'INBOUND' : 'OUTBOUND';
        this.debug(
            `[${direction}] Stream created for ${this.peerIdStr} proto=${protocol} streamId=${libp2pStream.id}`,
        );

        // Set up event listeners for the MessageStream interface
        this.messageHandler = (event: StreamMessageEvent) => {
            void this.handleMessage(event.data);
        };

        this.closeHandler = (_event: StreamCloseEvent) => {
            this.debug(
                `[${direction}] Stream close event from ${this.peerIdStr} (out=${this.outboundMessageCount} in=${this.inboundMessageCount} ackRx=${this.ackReceivedCount} ackTx=${this.ackSentCount})`,
            );
            void this.closeStream();
        };

        this.libp2pStream.addEventListener('message', this.messageHandler);
        this.libp2pStream.addEventListener('close', this.closeHandler);
    }

    public get peerIdStr(): string {
        return this.peerId.toString();
    }

    private get direction(): string {
        return this.opts.isInbound ? 'INBOUND' : 'OUTBOUND';
    }

    /**
     * Enqueues a message to send. We do a FIFO queue to avoid concurrency issues.
     */
    public sendMessage(data: Uint8Array): Promise<void> {
        if (this.isClosed) {
            return Promise.reject(new Error(`Stream to peer ${this.peerIdStr} is closed.`));
        }

        if (data.byteLength > this.opts.maxMessageSize) {
            return Promise.reject(
                new Error(
                    `Message exceeds max size: ${data.byteLength} > ${this.opts.maxMessageSize}`,
                ),
            );
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
     * Close the stream, cancelling any queued messages.
     */
    public async closeStream(): Promise<void> {
        if (this.isClosed) return;
        this.isClosed = true;
        this._isProcessingQueue = false;

        this.debug(
            `[${this.direction}] Closing stream for ${this.peerIdStr} (out=${this.outboundMessageCount} in=${this.inboundMessageCount} ackRx=${this.ackReceivedCount} ackTx=${this.ackSentCount} queueLen=${this.messageQueue.length})`,
        );

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

        // Reject any outbound messages still waiting
        const pending = this.messageQueue;
        this.messageQueue = [];

        for (const { reject } of pending) {
            reject(new Error('Stream closed before message was processed.'));
        }

        try {
            await this.libp2pStream.close();
        } catch {
            // Ignore close errors
        } finally {
            // Inform manager
            this.onClose(this.id);
        }
    }

    /**
     * Handle incoming messages from the stream
     */
    private async handleMessage(data: Uint8Array | Uint8ArrayList): Promise<void> {
        try {
            const bytes = data instanceof Uint8Array ? data : data.subarray();

            // If data is exactly [0x01], treat as ack
            if (bytes.length === 1 && bytes[0] === 0x01) {
                this.ackReceivedCount++;
                this.debug(
                    `[${this.direction}] Received ACK from ${this.peerIdStr} (total ackRx=${this.ackReceivedCount})`,
                );
                return;
            }

            if (bytes.byteLength > this.opts.maxMessageSize) {
                this.warn(
                    `[${this.direction}] Oversized message from ${this.peerIdStr}: ${bytes.byteLength} bytes, closing stream`,
                );
                await this.closeStream();
                return;
            }

            this.inboundMessageCount++;
            this.debug(
                `[${this.direction}] Received message from ${this.peerIdStr}: ${bytes.byteLength} bytes (total in=${this.inboundMessageCount})`,
            );

            // Otherwise, this is a real message. We always ack it:
            try {
                this.libp2pStream.send(Uint8Array.of(0x01));
                this.ackSentCount++;
                this.debug(
                    `[${this.direction}] Sent ACK to ${this.peerIdStr} (total ackTx=${this.ackSentCount})`,
                );
            } catch (err) {
                this.warn(`[${this.direction}] Failed to send ACK to ${this.peerIdStr}: ${err}`);
            }

            // If inbound, pass data along
            if (this.opts.isInbound && this.onInboundData) {
                await this.onInboundData(bytes, this);
            }
        } catch (err) {
            this.error(`[${this.direction}] Error handling message for ${this.peerIdStr}: ${err}`);
        }
    }

    /**
     * Process outbound messages in FIFO, sending each in turn.
     */
    private async processQueue(): Promise<void> {
        this._isProcessingQueue = true;

        while (this.messageQueue.length > 0) {
            if (this.isClosed) break;

            const item = this.messageQueue[0];
            try {
                await this.writeData(item.data);
                this.messageQueue.shift();
                item.resolve();
            } catch (err) {
                this.messageQueue.shift();
                item.reject(err);
            }
        }

        this._isProcessingQueue = false;
    }

    /**
     * Actually writes the data. MessageStream handles message framing.
     */
    private async writeData(data: Uint8Array): Promise<void> {
        this.resetIdleTimer();

        this.outboundMessageCount++;
        this.debug(
            `[${this.direction}] Sending ${data.byteLength} bytes to ${this.peerIdStr} (total out=${this.outboundMessageCount})`,
        );

        // Send the data directly - MessageStream handles framing
        this.libp2pStream.send(data);

        // Wait for drain if needed
        if (this.libp2pStream.writableNeedsDrain) {
            this.debug(`[${this.direction}] Waiting for drain to ${this.peerIdStr}`);
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
                this.debug(
                    `[${this.direction}] Idle timeout for ${this.peerIdStr} after ${this.opts.idleTimeoutMs}ms`,
                );
                void this.closeStream();
            }, this.opts.idleTimeoutMs);
        }
    }
}
