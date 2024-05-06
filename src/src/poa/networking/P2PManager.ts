import { DebugLevel, Logger } from '@btc-vision/bsi-common';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { bootstrap, BootstrapComponents } from '@libp2p/bootstrap';
import { Identify, identify } from '@libp2p/identify';
import {
    type ConnectionGater,
    CustomEvent,
    IdentifyResult,
    PeerDiscovery,
    PeerId,
    PeerInfo,
    PeerUpdate,
} from '@libp2p/interface';
import type { MultiaddrConnection } from '@libp2p/interface/src/connection/index.js';
import { KadDHT, kadDHT } from '@libp2p/kad-dht';
import { mdns } from '@libp2p/mdns';
import { MulticastDNSComponents } from '@libp2p/mdns/dist/src/mdns.js';
import { mplex } from '@libp2p/mplex';
import { tcp } from '@libp2p/tcp';
import { uPnPNAT } from '@libp2p/upnp-nat';
import { webSockets } from '@libp2p/websockets';
import type { Multiaddr } from '@multiformats/multiaddr';
import figlet, { Fonts } from 'figlet';
import { createLibp2p, Libp2p } from 'libp2p';
import { BtcIndexerConfig } from '../../config/BtcIndexerConfig.js';
import { P2PConfigurations } from '../configurations/P2PConfigurations.js';

type BootstrapDiscoveryMethod = (components: BootstrapComponents) => PeerDiscovery;

export class P2PManager extends Logger {
    public readonly logColor: string = '#00ffe1';

    private readonly p2pConfigurations: P2PConfigurations;

    private node: Libp2p<{ nat: unknown; kadDHT: KadDHT; identify: Identify }> | undefined;

    constructor(private readonly config: BtcIndexerConfig) {
        super();

        this.p2pConfigurations = new P2PConfigurations(this.config);
    }

    private get multiAddresses(): Multiaddr[] {
        if (!this.node) {
            throw new Error('Node not initialized');
        }

        return this.node.getMultiaddrs();
    }

    public async init(): Promise<void> {
        this.node = await this.createNode();

        await this.addListeners();
        await this.startNode();
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

        this.debug(`Disconnected from peer: ${peerId}`);
    }

    private async onPeerUpdate(_evt: CustomEvent<PeerUpdate>): Promise<void> {}

    private async onPeerIdentify(evt: CustomEvent<IdentifyResult>): Promise<void> {
        const agent: string | undefined = evt.detail.agentVersion;
        const version: string | undefined = evt.detail.protocolVersion;
        const peerId: PeerId = evt.detail.peerId;

        if (!this.allowConnection(peerId, agent, version)) {
            this.warn(
                `Dropping connection to peer: ${peerId.toString()} due to agent or version mismatch`,
            );
            return await this.disconnectPeer(peerId);
        }

        this.info(`Identified peer: ${peerId.toString()} - Agent: ${agent} - Version: ${version}`);
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
                `\n\nThis node is running in bootstrap mode. This means it will not connect to other peers automatically. It will only accept incoming connections.\n\n\n\n\n`,
            );
        }

        const addresses = this.multiAddresses;
        for (const address of addresses) {
            this.info(`Listening on ${address.toString()}`);
        }

        this.p2pConfigurations.savePeer(this.node.peerId);
    }

    private notifyArt(text: string, font: Fonts, prefix: string, suffix: string): void {
        const artVal = figlet.textSync(text, {
            font: font, //'Doh',
            horizontalLayout: 'default',
            verticalLayout: 'default',
        });

        this.info(`${prefix}${artVal}${suffix}`);
    }

    private allowConnection(
        _peerId: PeerId,
        agent: string | undefined,
        version: string | undefined,
    ): boolean {
        if (agent === undefined || version === undefined) {
            return false;
        }

        // TODO: Implement logic to allow or deny connection based on agent and version

        return true;
    }

    private async disconnectPeer(peerId: PeerId): Promise<void> {
        if (this.node === undefined) {
            throw new Error('Node not initialized');
        }

        await this.node.hangUp(peerId);
    }

    private async onPeerConnect(evt: CustomEvent<PeerId>): Promise<void> {
        const peerId = evt.detail.toString();

        this.success(`Connected to peer: ${peerId}`);
    }

    private async startNode(): Promise<void> {
        if (this.node === undefined) {
            throw new Error('Node not initialized');
        }

        await this.node.start();
    }

    private getConnectionGater(): ConnectionGater {
        return {
            denyInboundUpgradedConnection: this.denyInboundUpgradedConnection.bind(this),
            denyInboundConnection: this.denyInboundConnection.bind(this),
        };
    }

    private async denyInboundConnection(_maConn: MultiaddrConnection): Promise<boolean> {
        return false;
    }

    private async denyInboundUpgradedConnection(
        _peerId: PeerId,
        _maConn: MultiaddrConnection,
    ): Promise<boolean> {
        return false;
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

        return await createLibp2p({
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
