import { Socket } from 'net';
import { Logger } from '@btc-vision/bsi-common';

/**
 * A robust, optimized TCP socket wrapper that:
 * - uses keepalive
 * - sets no-delay
 * - buffers incoming data, parsing complete messages
 * - handles backpressure (via a write queue and drain events)
 * - logs connections, data reception, errors, closures, etc.
 */
export class TCPSocket extends Logger {
    public readonly logColor: string = '#00ff8c';

    private readonly enableDebug: boolean = false; // Set to true for verbose logging.

    private dataBuffer: Buffer = Buffer.alloc(0); // Accumulate partial data here.
    private isClosed: boolean = false; // Track if the socket is closed.
    private writeQueue: Array<{ data: Buffer; resolve: () => void; reject: (err: Error) => void }> =
        [];

    private isWritable: boolean = true; // Will set false if socket.write() returns false.

    constructor(private readonly socket: Socket) {
        super();
        this.init();
    }

    public handleOpcode = (
        _opcode: number,
        _contractId: bigint,
        _payload: Buffer,
    ): Promise<Buffer | undefined | void> => {
        throw new Error('Method not implemented.');
    };

    /**
     * Perform initial socket setup: keepalive, no-delay, event listeners.
     */
    private init(): void {
        // Enable Keep-Alive with a 512 second initial delay (adjust as needed).
        this.socket.setKeepAlive(true, 512_000);

        // Enable No-Delay (disable Nagle’s algorithm) for lower latency.
        this.socket.setNoDelay(true);

        // Attach listeners for socket events.
        this.socket.on('connect', this.onConnect.bind(this));
        this.socket.on('error', this.onError.bind(this));
        this.socket.on('close', this.onClose.bind(this));
        this.socket.on('end', this.onDisconnect.bind(this));
        // 'end' fires when the other end of the socket signals it is done (FIN packet).
        // 'close' can happen after end, or if error / forced close. They sometimes overlap.

        // Whenever the write buffer drains, try flushing anything left in the queue.
        this.socket.on('drain', () => {
            this.isWritable = true;
            this.flush();
        });

        // Collect data in a buffer, parse out complete messages.
        this.socket.on('data', async (chunk: Buffer) => {
            await this.onData(chunk);
        });
    }

    /**
     * Fires when the socket is connected (typically on a client socket).
     */
    private onConnect(): void {
        if (this.enableDebug) this.log(`TCP socket connected`, this.logColor);
    }

    /**
     * Fires when the remote end FINs or the socket ends in a normal way.
     */
    private onDisconnect(): void {
        if (this.enableDebug) this.warn(`TCP socket disconnected`, this.logColor);
        this.close();
    }

    /**
     * Fires on socket errors. Often leads to a close event.
     */
    private onError(err: Error): void {
        if (this.enableDebug) this.error(`Socket error: ${err.message}`);
        this.close();
    }

    /**
     * Fires on close, meaning no further events. Safe to release resources here.
     */
    private onClose(hadError: boolean): void {
        this.isClosed = true;
        if (this.enableDebug) this.log(`TCP socket closed (hadError=${hadError})`, this.logColor);
        // Clean up any leftover queue items.
        while (this.writeQueue.length > 0) {
            const queued = this.writeQueue.shift();
            if (queued) {
                queued.reject(new Error('Socket closed before flush.'));
            }
        }
    }

    /**
     * Called each time data arrives. This accumulates chunks, parses
     * complete messages, and handles opcode-based dispatch.
     *
     * Protocol example:
     *   - First 4 bytes: `payloadLength` (unsigned 32-bit integer, big-endian)
     *   - 1 byte: `opcode`
     *   - `payloadLength` bytes: payload
     */
    private async onData(chunk: Buffer): Promise<void> {
        // Concatenate the new data with any leftover from previous chunk.
        this.dataBuffer = Buffer.concat([this.dataBuffer, chunk]);

        // Attempt to parse as many full messages as possible.
        while (true) {
            // Minimum header = 5 bytes => 4 for length + 1 for opcode.
            if (this.dataBuffer.length < 13) {
                break;
            }

            // Next byte (the 5th) is the opcode.
            const opcode = this.dataBuffer.readUInt8(0);

            // Read the first 4 bytes for the payload length (big-endian).
            const payloadLength = this.dataBuffer.readUInt32BE(1);

            // Next 8 bytes are the contract ID.
            const contractId = this.dataBuffer.readBigUInt64BE(5);

            // We need 5 + payloadLength bytes total for a complete message.
            const totalLengthNeeded = 13 + payloadLength;
            if (this.dataBuffer.length < totalLengthNeeded) {
                // Not enough data yet for a complete message.
                break;
            }

            // Extract the payload.
            const payloadStart = 13;
            const payloadEnd = payloadStart + payloadLength;
            const payload = this.dataBuffer.subarray(payloadStart, payloadEnd);

            // Remove this message from the buffer.
            this.dataBuffer = this.dataBuffer.subarray(totalLengthNeeded);

            // Process the message and possibly respond:
            const response = await this.handleOpcode(opcode, contractId, payload);
            if (response) {
                await this.send(response);
            }
        }
    }

    /**
     * Attempt to write out all queued messages if the socket is writable.
     */
    private flush(): void {
        if (!this.isWritable || this.isClosed) {
            return;
        }

        while (this.writeQueue.length > 0 && this.isWritable) {
            const queued = this.writeQueue.shift();
            if (!queued) break;

            // Attempt to write the next chunk from the queue.
            const canWrite = this.socket.write(queued.data, (err) => {
                if (err) {
                    this.error(`Write error: ${err.message}`);
                    queued.reject(err);
                    return;
                }
                queued.resolve();
            });

            // If the write buffer is full, wait for the 'drain' event.
            if (!canWrite) {
                this.isWritable = false;
            }
        }
    }

    /**
     * Close the socket (if not already closed).
     */
    private close(): void {
        if (!this.isClosed) {
            this.isClosed = true;
            this.socket.end();
        }
    }

    /**
     * Send raw data directly (returns a Promise that resolves when data is flushed).
     */
    private async send(data: Buffer): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.isClosed) {
                return reject(new Error('Cannot send data: socket is closed.'));
            }

            // Attempt immediate write if we’re currently writable and queue is empty.
            if (this.writeQueue.length === 0 && this.isWritable) {
                const canWrite = this.socket.write(data, (err) => {
                    if (err) {
                        this.error(`Write error: ${err.message}`);
                        return reject(err);
                    }
                    return resolve();
                });

                if (!canWrite) {
                    // The buffer was full, so mark as non-writable and queue a flush.
                    this.isWritable = false;
                }
            } else {
                // Otherwise, push it to the queue.
                this.writeQueue.push({ data, resolve, reject });
            }
        });
    }
}
