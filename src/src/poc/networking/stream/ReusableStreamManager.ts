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

        if (!streamObj) {
            streamObj = await this.getOrCreateOutbound(peerId, key);
        }

        try {
            await streamObj.sendMessage(data);
        } catch {
            this.outboundMap.delete(key);
            streamObj = await this.getOrCreateOutbound(peerId, key);
            await streamObj.sendMessage(data);
        }
    }

    /**
     * Called by Libp2p's `node.handle(...)` for inbound streams.
     */
    public handleInboundStream(stream: Stream, connection: Connection): void {
        const peerIdStr = connection.remotePeer.toString();
        const key = this.makeKey(peerIdStr, this.defaultProtocol + connection.id);

        const existing = this.inboundMap.get(key);
        if (existing) {
            void existing.closeStream();
        }

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

        const outboundKeys = [...this.outboundMap.keys()].filter((k) => k.startsWith(prefix));
        for (const key of outboundKeys) {
            const stream = this.outboundMap.get(key);
            if (stream) closePromises.push(stream.closeStream());
        }

        const inboundKeys = [...this.inboundMap.keys()].filter((k) => k.startsWith(prefix));
        for (const key of inboundKeys) {
            const stream = this.inboundMap.get(key);
            if (stream) closePromises.push(stream.closeStream());
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

    private async getOrCreateOutbound(peerId: PeerId, key: string): Promise<ReusableStream> {
        let pending = this.pendingDials.get(key);
        if (!pending) {
            pending = this.createOutboundStream(peerId, key);
            this.pendingDials.set(key, pending);
        }

        try {
            return await pending;
        } finally {
            this.pendingDials.delete(key);
        }
    }

    private async createOutboundStream(peerId: PeerId, key: string): Promise<ReusableStream> {
        let conn: Stream;
        try {
            conn = await this.node.dialProtocol(peerId, this.defaultProtocol, {
                maxOutboundStreams: MAX_OUTBOUND_STREAMS_PER_PEER,
            });
        } catch (err) {
            throw new Error(`Failed to open outbound stream to ${peerId.toString()}: ${err}`, {
                cause: err,
            });
        }

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
