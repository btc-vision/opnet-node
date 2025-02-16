import { PeerId, Stream } from '@libp2p/interface';
import { LengthPrefixedStream, lpStream } from 'it-length-prefixed-stream';

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
 * - All reading is done in a single `readLoop()`.
 * - If we see `[0x01]`, it’s an ack for an outbound message -> we resolve the next ack waiter.
 * - Otherwise, we always send an ack ourselves, and if `isInbound=true`, call `onInboundData()`.
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

    private lp: LengthPrefixedStream<Stream>;

    /**
     * For `waitForAck = true`, each outbound message has a "waiter" that gets resolved
     * when `[0x01]` arrives. The read loop checks for `[0x01]`.
     */
    private ackWaiters: Array<{
        resolve: () => void;
        reject: (err: unknown) => void;
        timer: NodeJS.Timeout;
    }> = [];

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
        this.lp = lpStream(this.libp2pStream, {
            maxDataLength: this.opts.maxMessageSize,
        });

        // Start the single read loop for both inbound and outbound
        void this.readLoop();
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
     * Single read loop. Whenever we see `[0x01]`, that's an ack. Otherwise, we
     * automatically ack back with `[0x01]`, and if `isInbound` we call `onInboundData()`.
     */
    private async readLoop(): Promise<void> {
        try {
            while (!this.isClosed) {
                const chunk = await this.lp.read();
                if (!chunk) {
                    break;
                }

                if (chunk.length === 0) {
                    continue;
                }

                // If chunk is exactly [0x01], treat as ack
                if (chunk.length === 1 && chunk.getInt8(0) === 0x01 && chunk.length === 1) {
                    const w = this.ackWaiters.shift();
                    if (w) {
                        clearTimeout(w.timer);
                        w.resolve();
                    }
                    continue;
                }

                // Otherwise, this is a real message. We always ack it:
                await this.sendAck().catch(() => {});

                // If inbound, pass data along
                if (this.opts.isInbound && this.onInboundData) {
                    await this.onInboundData(chunk.subarray(), this);
                } else {
                    console.log('outbound -> Received data:', chunk);
                }
            }
        } catch (err) {
            //if (!this.isClosed) {
            //console.log(`Error reading data for ${this.peerIdStr}:`, err);
            //}
        } finally {
            if (!this.isClosed) {
                await this.closeStream();
            }
        }
    }

    /**
     * Sends a single byte [0x01] as an ack to the remote.
     */
    private async sendAck(): Promise<void> {
        await this.lp.write(Uint8Array.of(0x01));
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
     * Actually writes the data.
     */
    private async writeData(data: Uint8Array): Promise<void> {
        this.resetIdleTimer();

        await this.lp.write(data);

        // THIS IS DISABLED ATM. WE DO NOT NEED THIS FOR NOW.
        //if (!this.opts.waitForAck) {
        //    return;
        //}

        /*await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('Ack timeout'));
            }, this.opts.ackTimeoutMs);

            this.ackWaiters.push({ resolve, reject, timer });
        });*/
    }

    /**
     * Reset idle timer after a successful send. If no sends happen for `idleTimeoutMs`, close.
     */
    private resetIdleTimer() {
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
