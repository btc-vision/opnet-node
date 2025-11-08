import { Libp2p } from 'libp2p';
import { P2PConfigurations } from '../../configurations/P2PConfigurations.js';
import { AuthenticationManager } from '../server/managers/AuthenticationManager.js';
import { ReusableStream } from './ReusableStream.js';
import { PeerId, Stream } from '@libp2p/interface';
import { FastStringMap } from '../../../utils/fast/FastStringMap.js';
import type { Connection } from '@libp2p/interface/src';
import { Logger } from '@btc-vision/bsi-common';

const STREAM_IDLE_TIMEOUT_MS = 30_000;
const MAX_MESSAGE_SIZE_BYTES = 6 * 1024 * 1024;
const ACK_TIMEOUT_MS = 5_000;
const MAX_OUTBOUND_STREAMS_PER_PEER = 1024;

/**
 * A manager that stores "ReusableStream" objects for both inbound and outbound usage.
 */
export class ReusableStreamManager extends Logger {
    public readonly logColor: string = `#33ccff`;

    private node: Libp2p;

    private outboundMap: FastStringMap<ReusableStream> = new FastStringMap();
    private inboundMap: FastStringMap<ReusableStream> = new FastStringMap();

    private readonly onPeerMessage: (peerIdStr: PeerId, data: Uint8Array) => Promise<void>;

    constructor(
        node: Libp2p,
        onPeerMessage: (peerIdStr: PeerId, data: Uint8Array) => Promise<void>,
    ) {
        super();

        this.node = node;
        this.onPeerMessage = onPeerMessage;
    }

    private get defaultProtocol(): string {
        return `${P2PConfigurations.protocolName}/${AuthenticationManager.CURRENT_PROTOCOL_VERSION}`;
    }

    /**
     * Called by P2PManager to send a message. Reuses a single outbound
     * stream if it exists, else it dials a new one.
     */
    public async sendMessage(peerId: PeerId, data: Uint8Array): Promise<void> {
        const key = this.makeKey(peerId.toString(), this.defaultProtocol);
        let streamObj = this.outboundMap.get(key);

        // If we don't have an outbound stream for this peer+protocol, dial once
        if (!streamObj) {
            const conn = await this.node.dialProtocol(peerId, this.defaultProtocol, {
                maxOutboundStreams: MAX_OUTBOUND_STREAMS_PER_PEER,
            });

            streamObj = new ReusableStream(
                peerId,
                this.defaultProtocol,
                conn,
                {
                    isInbound: false,
                    idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
                    maxMessageSize: MAX_MESSAGE_SIZE_BYTES,
                    ackTimeoutMs: ACK_TIMEOUT_MS,
                    waitForAck: true,
                },
                key,
                this.onOutboundClosed.bind(this),
            );
            this.outboundMap.set(key, streamObj);
        }

        // Reuse the same ReusableStream
        await streamObj.sendMessage(data);
    }

    /**
     * Called by Libp2p's `node.handle(...)` for inbound streams.
     */
    public handleInboundStream(stream: Stream, connection: Connection): void {
        const peerIdStr = connection.remotePeer.toString();
        const key = this.makeKey(peerIdStr, this.defaultProtocol + connection.id);

        // Create the new inbound ReusableStream
        const streamObj = new ReusableStream(
            connection.remotePeer,
            this.defaultProtocol,
            stream,
            {
                isInbound: true,
                idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
                maxMessageSize: MAX_MESSAGE_SIZE_BYTES,
                ackTimeoutMs: ACK_TIMEOUT_MS,
                waitForAck: false,
            },
            key,
            this.onInboundClosed.bind(this),
            async (inboundData, rs) => {
                try {
                    await this.onPeerMessage(rs.peerId, inboundData);
                } catch (error) {
                    this.warn(`Something went wrong reading peer message: ${error}`);

                    await stream.close().catch(() => {});
                    await connection.close().catch(() => {});
                }
            },
        );
        this.inboundMap.set(key, streamObj);
    }

    private onOutboundClosed(key: string) {
        this.outboundMap.delete(key);
    }

    private onInboundClosed(key: string) {
        this.inboundMap.delete(key);
    }

    private makeKey(peerIdStr: string, protocol: string): string {
        return `${peerIdStr}::${protocol}`;
    }
}
