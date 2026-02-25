import { Libp2p } from 'libp2p';
import { P2PConfigurations } from '../../configurations/P2PConfigurations.js';
import { AuthenticationManager } from '../server/managers/AuthenticationManager.js';
import { ReusableStream } from './ReusableStream.js';
import type { Connection } from '@libp2p/interface';
import { PeerId, Stream } from '@libp2p/interface';
import { FastStringMap } from '../../../utils/fast/FastStringMap.js';
import { Logger } from '@btc-vision/bsi-common';

const STREAM_IDLE_TIMEOUT_MS = 30_000;
const MAX_MESSAGE_SIZE_BYTES = 6 * 1024 * 1024;
const MAX_OUTBOUND_STREAMS_PER_PEER = 1024;

/**
 * A manager that stores "ReusableStream" objects for both inbound and outbound usage.
 */
export class ReusableStreamManager extends Logger {
    public readonly logColor: string = `#33ccff`;

    private node: Libp2p;

    private outboundMap: FastStringMap<ReusableStream> = new FastStringMap();
    private inboundMap: FastStringMap<ReusableStream> = new FastStringMap();
    private pendingDials: FastStringMap<Promise<ReusableStream>> = new FastStringMap();

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
            let pending = this.pendingDials.get(key);
            if (!pending) {
                this.debug(`Creating new outbound stream to ${peerId.toString()}`);
                pending = this.createOutboundStream(peerId, key);
                this.pendingDials.set(key, pending);
            } else {
                this.debug(`Waiting on pending dial to ${peerId.toString()}`);
            }

            try {
                streamObj = await pending;
            } finally {
                this.pendingDials.delete(key);
            }
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

        this.debug(`Inbound stream from ${peerIdStr} connId=${connection.id}`);

        // Create the new inbound ReusableStream
        const streamObj = new ReusableStream(
            connection.remotePeer,
            this.defaultProtocol,
            stream,
            {
                isInbound: true,
                idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
                maxMessageSize: MAX_MESSAGE_SIZE_BYTES,
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

    /**
     * Close all streams associated with a peer. Called on peer disconnect.
     */
    public async closePeerStreams(peerIdStr: string): Promise<void> {
        const closePromises: Promise<void>[] = [];
        const prefix = peerIdStr + '::';

        for (const [key, stream] of this.outboundMap) {
            if (key.startsWith(prefix)) {
                this.debug(`Closing outbound stream for disconnected peer ${peerIdStr}`);
                closePromises.push(stream.closeStream());
            }
        }

        for (const [key, stream] of this.inboundMap) {
            if (key.startsWith(prefix)) {
                this.debug(`Closing inbound stream for disconnected peer ${peerIdStr}`);
                closePromises.push(stream.closeStream());
            }
        }

        if (closePromises.length > 0) {
            this.debug(`Closing ${closePromises.length} streams for peer ${peerIdStr}`);
            await Promise.allSettled(closePromises);
        }
    }

    public logStreamStats(): void {
        this.info(
            `Stream stats: outbound=${this.outboundMap.size} inbound=${this.inboundMap.size} pendingDials=${this.pendingDials.size}`,
        );
    }

    private async createOutboundStream(peerId: PeerId, key: string): Promise<ReusableStream> {
        const conn = await this.node.dialProtocol(peerId, this.defaultProtocol, {
            maxOutboundStreams: MAX_OUTBOUND_STREAMS_PER_PEER,
        });

        this.debug(`Outbound stream established to ${peerId.toString()} streamId=${conn.id}`);

        const streamObj = new ReusableStream(
            peerId,
            this.defaultProtocol,
            conn,
            {
                isInbound: false,
                idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
                maxMessageSize: MAX_MESSAGE_SIZE_BYTES,
            },
            key,
            this.onOutboundClosed.bind(this),
        );

        this.outboundMap.set(key, streamObj);
        return streamObj;
    }

    private onOutboundClosed(key: string) {
        this.debug(`Outbound stream closed: ${key}`);
        this.outboundMap.delete(key);
    }

    private onInboundClosed(key: string) {
        this.debug(`Inbound stream closed: ${key}`);
        this.inboundMap.delete(key);
    }

    private makeKey(peerIdStr: string, protocol: string): string {
        return `${peerIdStr}::${protocol}`;
    }
}
