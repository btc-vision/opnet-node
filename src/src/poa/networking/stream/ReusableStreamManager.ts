import { Libp2p } from 'libp2p';
import { P2PConfigurations } from '../../configurations/P2PConfigurations.js';
import { AuthenticationManager } from '../server/managers/AuthenticationManager.js';
import { ReusableStream } from './ReusableStream.js';
import { PeerId } from '@libp2p/interface';
import { IncomingStreamData } from '@libp2p/interface/src/stream-handler.js';
import { FastStringMap } from '../../../utils/fast/FastStringMap.js';

const STREAM_IDLE_TIMEOUT_MS = 30_000;
const MAX_MESSAGE_SIZE_BYTES = 6 * 1024 * 1024;
const ACK_TIMEOUT_MS = 5_000;
const MAX_OUTBOUND_STREAMS_PER_PEER = 1024;

/**
 * A manager that stores "ReusableStream" objects for both inbound and outbound usage.
 */
export class ReusableStreamManager {
    private node: Libp2p;

    /**
     * We'll store inbound streams keyed by (peerId + protocol),
     * and outbound streams likewise.
     */
    private outboundMap: FastStringMap<ReusableStream> = new FastStringMap();
    private inboundMap: FastStringMap<ReusableStream> = new FastStringMap();

    /**
     * A reference to your “onPeerMessage” handler. This is how we hand off inbound data
     * to your actual message logic, instead of just logging it.
     */
    private readonly onPeerMessage: (peerIdStr: PeerId, data: Uint8Array) => Promise<void>;

    constructor(
        node: Libp2p,
        onPeerMessage: (peerIdStr: PeerId, data: Uint8Array) => Promise<void>,
    ) {
        this.node = node;
        this.onPeerMessage = onPeerMessage;
    }

    private get defaultProtocol(): string {
        return `${P2PConfigurations.protocolName}/${AuthenticationManager.CURRENT_PROTOCOL_VERSION}`;
    }

    /**
     * Called by P2PManager (or wherever) to **send** a message. Reuses a single outbound
     * stream if it exists, else it dials a new one.
     */
    public async sendMessage(peerId: PeerId, data: Uint8Array): Promise<void> {
        const key = this.makeKey(peerId.toString(), this.defaultProtocol);
        let streamObj = this.outboundMap.get(key);

        // If we don’t have an outbound stream for this peer+protocol, dial once
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
                /* id: */ key,
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
    public handleInboundStream(incoming: IncomingStreamData): void {
        const { stream, connection } = incoming;
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
                waitForAck: false, // inbound side is the ack "sender"
            },
            /* id: */ key,
            this.onInboundClosed.bind(this),
            async (inboundData, rs) => {
                // Forward inbound data to your application logic
                await this.onPeerMessage(rs.peerId, inboundData);
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
