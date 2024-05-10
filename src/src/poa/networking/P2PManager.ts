import { DebugLevel, Logger } from '@btc-vision/bsi-common';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { bootstrap, BootstrapComponents } from '@libp2p/bootstrap';
import { Identify, identify } from '@libp2p/identify';
import {
    type ConnectionGater,
    CustomEvent,
    IdentifyResult,
    Peer,
    PeerDiscovery,
    PeerId,
    PeerInfo,
    PeerUpdate,
} from '@libp2p/interface';
import type { MultiaddrConnection } from '@libp2p/interface/src/connection/index.js';
import { IncomingStreamData } from '@libp2p/interface/src/stream-handler/index.js';
import { KadDHT, kadDHT } from '@libp2p/kad-dht';
import { mdns } from '@libp2p/mdns';
import { MulticastDNSComponents } from '@libp2p/mdns/dist/src/mdns.js';
import { mplex } from '@libp2p/mplex';
import { tcp } from '@libp2p/tcp';
import { uPnPNAT } from '@libp2p/upnp-nat';
import { webSockets } from '@libp2p/websockets';
import type { Multiaddr } from '@multiformats/multiaddr';
import figlet, { Fonts } from 'figlet';
import type { Datastore } from 'interface-datastore';
import { lpStream } from 'it-length-prefixed-stream';
import { createLibp2p, Libp2p } from 'libp2p';
import { BtcIndexerConfig } from '../../config/BtcIndexerConfig.js';
import { P2PConfigurations } from '../configurations/P2PConfigurations.js';
import { OPNetIdentity } from '../identity/OPNetIdentity.js';
import { OPNetPeer } from '../peer/OPNetPeer.js';
import { DisconnectionCode } from './enums/DisconnectionCode.js';
import { AuthenticationManager } from './server/managers/AuthenticationManager.js';

type BootstrapDiscoveryMethod = (components: BootstrapComponents) => PeerDiscovery;

export class P2PManager extends Logger {
    public readonly logColor: string = '#00ffe1';

    private readonly p2pConfigurations: P2PConfigurations;
    private node: Libp2p<{ nat: unknown; kadDHT: KadDHT; identify: Identify }> | undefined;

    private pendingNodeIdentifications: Map<string, NodeJS.Timeout> = new Map();

    private peers: Map<string, OPNetPeer> = new Map();

    private blackListedPeerIds: Set<string> = new Set();
    private blackListedPeerIps: Set<string> = new Set();

    private readonly identity: OPNetIdentity;

    constructor(private readonly config: BtcIndexerConfig) {
        super();

        this.p2pConfigurations = new P2PConfigurations(this.config);
        this.identity = new OPNetIdentity(this.config);
    }

    private get multiAddresses(): Multiaddr[] {
        if (!this.node) {
            throw new Error('Node not initialized');
        }

        return this.node.getMultiaddrs();
    }

    private get defaultHandle(): string {
        return `${P2PConfigurations.protocolName}/${AuthenticationManager.CURRENT_PROTOCOL_VERSION}`;
    }

    public async init(): Promise<void> {
        this.node = await this.createNode();

        await this.addListeners();
        await this.startNode();
        await this.addHandles();
        await this.onStarted();
    }

    public override info(...args: unknown[]): void {
        if (this.config.DEBUG_LEVEL < DebugLevel.INFO) {
            return;
        }

        super.info(...args);
    }

    private isBootstrapNode(): boolean {
        return this.config.P2P.IS_BOOTSTRAP_NODE;
    }

    private async addListeners(): Promise<void> {
        if (this.node === undefined) {
            throw new Error('Node not initialized');
        }

        this.node.addEventListener('peer:discovery', this.onPeerDiscovery.bind(this));
        this.node.addEventListener('peer:disconnect', this.onPeerDisconnect.bind(this));
        this.node.addEventListener('peer:update', this.onPeerUpdate.bind(this));
        this.node.addEventListener('peer:identify', this.onPeerIdentify.bind(this));
        this.node.addEventListener('peer:connect', this.onPeerConnect.bind(this));
    }

    private async onPeerDiscovery(evt: CustomEvent<PeerInfo>): Promise<void> {
        const peerId = evt.detail.id.toString();

        this.info(`Discovered peer: ${peerId}`);
    }

    private async onPeerDisconnect(evt: CustomEvent<PeerId>): Promise<void> {
        const peerId = evt.detail.toString();

        const peer = this.peers.get(peerId);
        if (peer) {
            await peer.onDisconnect();

            this.peers.delete(peerId);
        }
    }

    private async onPeerUpdate(_evt: CustomEvent<PeerUpdate>): Promise<void> {}

    private async onPeerIdentify(evt: CustomEvent<IdentifyResult>): Promise<void> {
        if (!this.node) throw new Error('Node not initialized');

        const agent: string | undefined = evt.detail.agentVersion;
        const version: string | undefined = evt.detail.protocolVersion;
        const peerId: PeerId = evt.detail.peerId;
        const peerIdStr: string = peerId.toString();

        const timeout = this.pendingNodeIdentifications.get(peerIdStr);
        if (timeout) {
            clearTimeout(timeout);
            this.pendingNodeIdentifications.delete(peerIdStr);
        }

        if (!this.allowConnection(peerId, agent, version)) {
            this.warn(`Dropping connection to peer: ${peerIdStr} due to agent or version mismatch`);

            this.blackListPeerId(peerId);
            return await this.disconnectPeer(peerId);
        }

        this.info(`Identified peer: ${peerIdStr} - Agent: ${agent} - Version: ${version}`);

        /*const nodeLength = await this.getPeers();
        if (nodeLength.length === 1) {
            this.notifyArt(
                'OPNet',
                'Doh',
                `\n\n\nPoA enabled. At least one peer was found! You are now connected to,\n\n\n\n\n`,
                `\n\nAuthenticating this node. Looking for peers...\n\n\n\n\n`,
            );
        }*/

        await this.createPeer(evt.detail, peerIdStr);
    }

    private async createPeer(peerInfo: IdentifyResult, peerIdStr: string): Promise<void> {
        if (this.peers.has(peerIdStr)) {
            throw new Error(`Peer (client) ${peerIdStr} already exists. Memory leak detected.`);
        }

        const peer: OPNetPeer = new OPNetPeer(peerInfo, this.identity);
        peer.disconnectPeer = this.disconnectPeer.bind(this);
        peer.sendMsg = this.sendToPeer.bind(this);

        this.peers.set(peerIdStr, peer);

        await peer.init();
        await peer.authenticate();
    }

    private blackListPeerId(peerId: PeerId): void {
        if (!this.blackListedPeerIds.has(peerId.toString())) {
            this.blackListedPeerIds.add(peerId.toString());
        }

        try {
            this.node?.peerStore.delete(peerId);
        } catch (e) {}
    }

    private getPeers(): Promise<Peer[]> {
        if (!this.node) {
            throw new Error('Node not initialized');
        }

        return this.node.peerStore.all();
    }

    private async onStarted(): Promise<void> {
        if (!this.node) {
            throw new Error('Node not initialized');
        }

        this.success('P2PManager initialized. Looking for peers...');

        if (this.isBootstrapNode()) {
            this.notifyArt(
                'OPNet Bootstrap Node',
                'Big Money-sw',
                `\n\n\nPoA enabled. This node is a,\n\n\n\n\n`,
                `\n\nThis node is running in bootstrap mode. This means it will not connect to other peers automatically. It will only accept incoming connections.\n`,
                `This node bitcoin address is ${this.identity.tapAddress} (taproot) or ${this.identity.segwitAddress} (segwit).\n`,
                `Your OPNet identity is ${this.identity.opnetAddress}.\n\n\n\n\n`,
            );
        }

        const addresses = this.multiAddresses;
        for (const address of addresses) {
            this.info(`Listening on ${address.toString()}`);
        }

        this.p2pConfigurations.savePeer(this.node.peerId);
    }

    private notifyArt(text: string, font: Fonts, prefix: string, ...suffix: string[]): void {
        const artVal = figlet.textSync(text, {
            font: font, //'Doh',
            horizontalLayout: 'default',
            verticalLayout: 'default',
        });

        this.info(`${prefix}${artVal}${suffix.join('\n')}`);
    }

    private allowConnection(
        peerId: PeerId,
        agent: string | undefined,
        version: string | undefined,
    ): boolean {
        if (agent === undefined || version === undefined) {
            return false;
        }

        // TODO: Implement logic to allow or deny connection based on agent and version
        const id: string = peerId.toString();
        if (this.blackListedPeerIds.has(id)) {
            if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                this.debug(`Peer ${id} is blacklisted. Flushing connection...`);
            }

            return false;
        }

        return true;
    }

    private async disconnectPeer(
        peerId: PeerId,
        code: number = DisconnectionCode.RECONNECT,
        _reason?: string,
    ): Promise<void> {
        if (this.node === undefined) {
            throw new Error('Node not initialized');
        }

        if (code !== DisconnectionCode.RECONNECT && code !== DisconnectionCode.EXPECTED) {
            this.blackListPeerId(peerId);

            try {
                const peer = await this.node.peerStore.get(peerId);
                if (peer) {
                    this.blacklistPeerIps(peer);
                }
            } catch (e) {}
        }

        await this.node.hangUp(peerId).catch(() => {});
    }

    private blacklistPeerIps(peer: Peer): void {
        const address = peer.addresses;

        if (address.length === 0) {
            return;
        }

        for (const addr of address) {
            const ip = addr.toString().split('/')[1];
            if (ip && !this.blackListedPeerIps.has(ip)) {
                this.blackListedPeerIps.add(ip);
            }
        }
    }

    private async onPeerConnect(evt: CustomEvent<PeerId>): Promise<void> {
        const peerId = evt.detail.toString();

        this.success(`Connected to peer: ${peerId}`);

        const timeout = setTimeout(() => {
            this.warn(`Identification timeout for peer: ${peerId}`);
            this.pendingNodeIdentifications.delete(peerId);

            this.disconnectPeer(evt.detail);
        }, 5000);
        this.pendingNodeIdentifications.set(peerId, timeout);
    }

    private async startNode(): Promise<void> {
        if (this.node === undefined) {
            throw new Error('Node not initialized');
        }

        await this.node.start();
    }

    private async addHandles(): Promise<void> {
        if (this.node === undefined) {
            throw new Error('Node not initialized');
        }

        await this.node.handle(this.defaultHandle, async (incomingStream: IncomingStreamData) => {
            const stream = incomingStream.stream;
            const connection = incomingStream.connection;

            const peerId: PeerId = connection.remotePeer;

            try {
                const lp = lpStream(stream);
                const req = await lp.read();

                if (!req) {
                    return;
                }

                // TODO: Check if this may contain multiple messages or if this is junk chunks of data
                const data: Uint8Array = req.subarray();

                /** We could await for the message to process and send a response but this may lead to timeout in some cases */
                void this.onPeerMessage(peerId, data);

                // Acknowledge the message
                await lp.write(new Uint8Array([0x01])).catch(() => {});
            } catch (e) {
                if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                    this.debug('Error while handling incoming stream', (e as Error).stack);
                }

                await this.disconnectPeer(
                    peerId,
                    DisconnectionCode.BAD_PEER,
                    'Error while handling incoming stream',
                );
            }

            // Close the stream
            await stream.close().catch(() => {});
        });
    }

    /** We could return a Uint8Array to send a response. For the protocol v1, we will ignore that. */
    private async onPeerMessage(peerId: PeerId, data: Uint8Array): Promise<void> {
        const id: string = peerId.toString();
        const peer: OPNetPeer | undefined = this.peers.get(id);

        if (!peer) {
            this.warn(`Received message from unknown peer: ${id}`);
            return;
        }

        await peer.onMessage(data);
    }

    /** Broadcast a message to all connected peers */
    private async broadcastMessage(data: Uint8Array): Promise<void> {
        if (this.node === undefined) {
            throw new Error('Node not initialized');
        }

        const peers = await this.getPeers();

        const sentPromises: Promise<void>[] = [];
        for (const peer of peers) {
            if (peer.id === this.node.peerId) {
                continue;
            }

            sentPromises.push(this.sendToPeer(peer.id, data));
        }

        await Promise.all(sentPromises);
    }

    /** Send a message to a specific peer */
    private async sendToPeer(peerId: PeerId, data: Uint8Array): Promise<void> {
        if (this.node === undefined) {
            throw new Error('Node not initialized');
        }

        const connection = await this.node.dialProtocol(peerId, this.defaultHandle);
        try {
            const lp = lpStream(connection);

            await lp.write(data);

            const ack = await lp.read();
            const ackData = ack ? ack.subarray() : new Uint8Array();

            if (ackData[0] !== 0x01) {
                if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                    this.debug(`Peer ${peerId.toString()} did not acknowledge the message.`);
                }

                await this.disconnectPeer(
                    peerId,
                    DisconnectionCode.BAD_PEER,
                    'Peer did not acknowledge the message.',
                );
            }
        } catch (e) {
            const error = e as Error;

            if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                this.error(
                    `Error while sending message to peer ${peerId.toString()}: ${error.stack}`,
                );
            }
        }

        await connection.close().catch(() => {});
    }

    private getConnectionGater(): ConnectionGater {
        return {
            denyInboundUpgradedConnection: this.denyInboundUpgradedConnection.bind(this),
            denyInboundConnection: this.denyInboundConnection.bind(this),
            denyOutboundConnection: this.denyOutboundConnection.bind(this),
            denyOutboundUpgradedConnection: this.denyOutboundUpgradedConnection.bind(this),
        };
    }

    private async denyOutboundUpgradedConnection(
        peerId: PeerId,
        _maConn: MultiaddrConnection,
    ): Promise<boolean> {
        const id: string = peerId.toString();

        if (this.isBlackListedPeerId(peerId)) {
            if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                this.debug(`[OUT] Peer ${id} is blacklisted. Flushing connection...`);
            }

            return true;
        }

        return false;
    }

    private async denyOutboundConnection(
        peerId: PeerId,
        _maConn: MultiaddrConnection,
    ): Promise<boolean> {
        const id: string = peerId.toString();

        if (this.isBlackListedPeerId(peerId)) {
            if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                this.debug(`[OUT] Peer ${id} is blacklisted. Flushing connection...`);
            }

            return true;
        }

        return false;
    }

    private isBlackListedPeerId(peerId: PeerId): boolean {
        return this.blackListedPeerIds.has(peerId.toString());
    }

    private async denyInboundConnection(_maConn: MultiaddrConnection): Promise<boolean> {
        return false;
    }

    private async denyInboundUpgradedConnection(
        peerId: PeerId,
        _maConn: MultiaddrConnection,
    ): Promise<boolean> {
        const id: string = peerId.toString();

        if (this.isBlackListedPeerId(peerId)) {
            if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                this.debug(`Peer ${id} is blacklisted. Flushing connection...`);
            }

            return true;
        }

        return false;
    }

    private async getDatastore(): Promise<Datastore | undefined> {
        return await this.p2pConfigurations.getDataStore();
    }

    private async createNode(): Promise<
        Libp2p<{ nat: unknown; kadDHT: KadDHT; identify: Identify }>
    > {
        const peerId = await this.p2pConfigurations.peerIdConfigurations();

        const peerDiscovery: [
            (components: MulticastDNSComponents) => PeerDiscovery,
            BootstrapDiscoveryMethod?,
        ] = [mdns(this.p2pConfigurations.multicastDnsConfiguration)];

        if (!this.isBootstrapNode()) {
            peerDiscovery.push(bootstrap(this.p2pConfigurations.bootstrapConfiguration));
        }

        const datastore = await this.getDatastore();

        return await createLibp2p({
            datastore: datastore,
            peerId: peerId,
            transports: [
                tcp(this.p2pConfigurations.tcpConfiguration),
                webSockets(this.p2pConfigurations.websocketConfiguration),
            ],
            connectionEncryption: [noise()],
            connectionGater: this.getConnectionGater(),
            streamMuxers: [
                yamux(this.p2pConfigurations.yamuxConfiguration),
                mplex(this.p2pConfigurations.mplexConfiguration),
            ],
            addresses: this.p2pConfigurations.listeningConfiguration,
            peerDiscovery: peerDiscovery,
            nodeInfo: this.p2pConfigurations.nodeConfigurations,
            connectionManager: this.p2pConfigurations.connectionManagerConfiguration,
            peerStore: this.p2pConfigurations.peerStoreConfiguration,
            transportManager: this.p2pConfigurations.transportManagerConfiguration,
            services: {
                nat: uPnPNAT(this.p2pConfigurations.upnpConfiguration),
                kadDHT: kadDHT(this.p2pConfigurations.dhtConfiguration),
                identify: identify(this.p2pConfigurations.identifyConfiguration),
            },
        });
    }
}
