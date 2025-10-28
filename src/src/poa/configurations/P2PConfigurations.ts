import type { YamuxMuxerInit } from '@chainsafe/libp2p-yamux';
import type { BootstrapInit } from '@libp2p/bootstrap';
import type { IdentifyInit } from '@libp2p/identify';
import type { NodeInfo, PeerId, PrivateKey } from '@libp2p/interface';
import { FaultTolerance } from '@libp2p/interface-transport';
import { KadDHTInit, removePrivateAddressesMapper } from '@libp2p/kad-dht';
import { MulticastDNSInit } from '@libp2p/mdns';
import type { PersistentPeerStoreInit } from '@libp2p/peer-store';
import { TCPOptions } from '@libp2p/tcp';
import { UPnPNATInit } from '@libp2p/upnp-nat';
import { LevelDatastore } from 'datastore-level';
import fs from 'fs';
import type { AddressManagerInit, ConnectionManagerInit, TransportManagerInit } from 'libp2p';
import path from 'path';
import { BtcIndexerConfig } from '../../config/BtcIndexerConfig.js';
import { PeerToPeerMethod } from '../../config/interfaces/PeerToPeerMethod.js';
import { OPNetPathFinder } from '../identity/OPNetPathFinder.js';
import { BootstrapNodes } from './BootstrapNodes.js';
import { P2PMajorVersion, P2PVersion } from './P2PVersion.js';
import { generateKeyPair, privateKeyFromRaw } from '@libp2p/crypto/keys';
import { Config } from '../../config/Config.js';
import { Multiaddr, multiaddr } from '@multiformats/multiaddr';
import { AutoNATv2ServiceInit } from '@libp2p/autonat-v2';

interface BackedUpPeer {
    id: string;
    privKey?: Buffer;
    pubKey?: string;
}

export class P2PConfigurations extends OPNetPathFinder {
    public static readonly protocolName: string = 'opnet';
    public static readonly protocolVersion: string = '1.0.0';
    public static readonly maxMessageSize: number = 6 * 1024 * 1024; // 6 MiB

    private readonly defaultBootstrapNodes: string[];
    private bootstrapPeerIds: Set<string> = new Set();

    constructor(private readonly config: BtcIndexerConfig) {
        super();
        this.defaultBootstrapNodes = this.getDefaultBootstrapNodes();
        this.initializeBootstrapPeerIds();
    }

    public get tcpConfiguration(): TCPOptions {
        return {
            inboundSocketInactivityTimeout: this.config.P2P.PEER_INACTIVITY_TIMEOUT,
            outboundSocketInactivityTimeout: this.config.P2P.PEER_INACTIVITY_TIMEOUT,
            maxConnections: this.config.P2P.MAXIMUM_PEERS,
            socketCloseTimeout: 10000,
            backlog: 100,
            closeServerOnMaxConnections: {
                closeAbove: this.config.P2P.MAXIMUM_PEERS,
                listenBelow: this.config.P2P.MINIMUM_PEERS,
            },
        };
    }

    public get yamuxConfiguration(): YamuxMuxerInit {
        return {
            /**
             * The total number of inbound protocol streams that can be opened on a given connection
             *
             * This field is optional, the default value is shown
             */
            maxInboundStreams: this.config.P2P.MAXIMUM_INBOUND_STREAMS,

            /**
             * The total number of outbound protocol streams that can be opened on a given connection
             *
             * This field is optional, the default value is shown
             */
            maxOutboundStreams: this.config.P2P.MAXIMUM_OUTBOUND_STREAMS,
            maxMessageSize: P2PConfigurations.maxMessageSize,

            enableKeepAlive: true,
            keepAliveInterval: 15000,

            initialStreamWindowSize: 256 * 1024,

            maxStreamWindowSize: P2PConfigurations.maxMessageSize,
        };
    }

    public get listeningConfiguration(): AddressManagerInit {
        const listenAt: string[] = [];
        const port = this.config.P2P.P2P_PORT ?? 0;
        const host = this.config.P2P.P2P_HOST ?? '0.0.0.0';
        const protocol = this.config.P2P.P2P_PROTOCOL ?? PeerToPeerMethod.TCP;

        listenAt.push(`/ip4/${host}/${protocol}/${port}`);

        if (this.config.P2P.ENABLE_IPV6) {
            const host = this.config.P2P.P2P_HOST_V6 ?? '::';
            const port = this.config.P2P.P2P_PORT_V6 ?? 0;
            listenAt.push(`/ip6/${host}/${protocol}/${port}`);
        }

        // Critical: Add announce addresses for external connectivity
        const announce: string[] = [];

        if (this.config.P2P.ANNOUNCE_ADDRESSES && this.config.P2P.ANNOUNCE_ADDRESSES.length > 0) {
            announce.push(...this.config.P2P.ANNOUNCE_ADDRESSES);
        } else if (port !== 0 && host !== '0.0.0.0') {
            // Only announce non-wildcard addresses
            announce.push(`/ip4/${host}/${protocol}/${port}`);
        }

        // Don't announce private addresses
        const noAnnounce = [
            '/ip4/127.0.0.0/ipcidr/8', // All loopback addresses
            '/ip4/10.0.0.0/ipcidr/8', // Private network
            '/ip4/172.16.0.0/ipcidr/12', // Private network
            '/ip4/192.168.0.0/ipcidr/16', // Private network
            '/ip6/::1/ipcidr/128', // IPv6 loopback
            '/ip6/fc00::/ipcidr/7', // IPv6 unique local
            '/ip6/fe80::/ipcidr/10', // IPv6 link local
        ];

        return {
            listen: listenAt,
            announce: announce.length > 0 ? announce : undefined,
            noAnnounce,
        };
    }

    public get bootstrapConfiguration(): BootstrapInit {
        return {
            timeout: 15000,
            tagValue: 100,
            tagTTL: 120000,
            list: this.getBootstrapPeers(),
        };
    }

    public get multicastDnsConfiguration(): MulticastDNSInit {
        return {
            broadcast: true,
            interval: 20000,
            serviceTag: 'opnet.local',
            peerName: 'opnet-node',
        };
    }

    public get connectionManagerConfiguration(): ConnectionManagerInit {
        const isBootstrap = this.config.P2P.IS_BOOTSTRAP_NODE;

        return {
            reconnectRetries: 3,
            reconnectRetryInterval: 5000,

            maxParallelDials: isBootstrap ? 200 : 100,

            outboundStreamProtocolNegotiationTimeout: 10000,
            inboundStreamProtocolNegotiationTimeout: 10000,
            dialTimeout: 10000,
            maxParallelReconnects: isBootstrap ? 20 : 10,

            /**
             * A remote peer may attempt to open up to this many connections per second,
             * any more than that will be automatically rejected
             */
            inboundConnectionThreshold: isBootstrap ? 20 : 10,

            /**
             * The total number of connections allowed to be open at one time
             * Bootstrap nodes should handle more connections
             */
            maxConnections: isBootstrap
                ? this.config.P2P.MAXIMUM_PEERS * 2
                : this.config.P2P.MAXIMUM_PEERS,

            /**
             * How many connections can be open but not yet upgraded
             */
            maxIncomingPendingConnections: isBootstrap
                ? this.config.P2P.MAXIMUM_INCOMING_PENDING_PEERS * 2
                : this.config.P2P.MAXIMUM_INCOMING_PENDING_PEERS,
        };
    }

    public get peerStoreConfiguration(): PersistentPeerStoreInit {
        return {
            addressFilter: (peerId: PeerId, multiaddr: Multiaddr) => {
                const str = multiaddr.toString();

                // Always keep bootstrap peer addresses
                if (this.isBootstrapPeer(peerId.toString())) {
                    return true;
                }

                // Filter out obvious private/local addresses
                if (
                    str.includes('/127.0.0.1/') ||
                    str.includes('/::1/') ||
                    str.includes('/0.0.0.0/')
                ) {
                    return false;
                }

                // Keep all other addresses (including private network for testing)
                return true;
            },

            // Increase address TTL to prevent premature expiry
            maxAddressAge: 24 * 60 * 60 * 1000, // 24 hours

            // Keep peers even without addresses for longer
            maxPeerAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        };
    }

    public get nodeConfigurations(): NodeInfo {
        return {
            userAgent: `${P2PConfigurations.protocolName}/${P2PVersion}`,
            name: `${P2PConfigurations.protocolName}/${P2PVersion}`,
            version: P2PConfigurations.protocolVersion,
        };
    }

    public get transportManagerConfiguration(): TransportManagerInit {
        return {
            faultTolerance: FaultTolerance.FATAL_ALL,
        };
    }

    public get upnpConfiguration(): UPnPNATInit {
        return {
            portMappingDescription: P2PConfigurations.protocolName,
            portMappingTTL: 7200,

            // Enable auto refresh to maintain NAT mappings
            portMappingAutoRefresh: true,
            portMappingRefreshThreshold: 60000, // Refresh 1 minute before expiry

            // Auto-confirm addresses to speed up connectivity
            autoConfirmAddress: false, // Keep false for security

            // Increase gateway search intervals after initial discovery
            initialGatewaySearchInterval: 5000,
            gatewaySearchInterval: 300000, // 5 minutes
            gatewaySearchTimeout: 60000,
        };
    }

    public get dhtConfiguration(): KadDHTInit {
        return {
            kBucketSize: 30,
            clientMode: this.config.P2P.CLIENT_MODE,
            protocol: this.protocol,
            peerInfoMapper: removePrivateAddressesMapper,
            logPrefix: 'libp2p:dht-amino',
            datastorePrefix: '/dht-amino',
            metricsPrefix: 'libp2p_dht_amino',
            querySelfInterval: 300000, // 5 minutes
            initialQuerySelfInterval: 5000,
            allowQueryWithZeroPeers: false,
        };
    }

    public get autoNATConfiguration(): AutoNATv2ServiceInit {
        return {
            protocolPrefix: P2PConfigurations.protocolName,

            // 15 seconds is reasonable for verification
            timeout: 15000,
            startupDelay: 10000,
            refreshInterval: 360000,

            // Limit concurrent streams to prevent resource exhaustion
            maxInboundStreams: 2,
            maxOutboundStreams: 2,
            connectionThreshold: 80,

            // 8KB is reasonable for autonat messages
            maxMessageSize: 8192,

            // Anti-amplification protection (v2 specific)
            // 200KB limit for dial-back data
            maxDialDataBytes: 200_000n,
            dialDataChunkSize: 4096,
        };
    }

    public get identifyConfiguration(): IdentifyInit {
        return {
            protocolPrefix: P2PConfigurations.protocolName,
            timeout: 10000,
            maxInboundStreams: 5,
            maxOutboundStreams: 5,
            maxObservedAddresses: 15,
            runOnConnectionOpen: true,
            runOnLimitedConnection: true,
        };
    }

    public get protocol(): string {
        return `${P2PConfigurations.protocolName}/op/${P2PMajorVersion}`;
    }

    public isBootstrapPeer(peerId: string): boolean {
        return this.bootstrapPeerIds.has(peerId);
    }

    public async privateKeyConfigurations(): Promise<PrivateKey> {
        const thisPeer = this.loadPeer();
        if (!thisPeer || !thisPeer.privKey) {
            return generateKeyPair('Ed25519');
        }
        return privateKeyFromRaw(thisPeer.privKey);
    }

    public savePeer(peer: PeerId, privKey: PrivateKey): void {
        if (!peer.publicKey) {
            throw new Error('Peer does not have a public key.');
        }

        const peerIdentity: {
            id: string;
            privKey: string | Buffer;
            pubKey: string;
        } = {
            id: peer.toString(),
            privKey: this.uint8ArrayToString(privKey.raw),
            pubKey: this.uint8ArrayToString(peer.publicKey.toCID().bytes),
        };

        const encrypted = this.encrypt(JSON.stringify(peerIdentity));
        fs.writeFileSync(this.peerFilePath(), encrypted, 'binary');
    }

    public async getDataStore(): Promise<LevelDatastore | undefined> {
        const levelDbStore = this.getDataStorePath();
        this.createDirIfNotExists(levelDbStore);

        const dataStore = new LevelDatastore(levelDbStore);
        try {
            await dataStore.open();
        } catch (e) {
            console.log(`Failed to open data store: ${(e as Error).stack}`);
            return undefined;
        }
        return dataStore;
    }

    public getBootstrapPeers(): string[] {
        // Deduplicate bootstrap peers
        const peers = new Set([
            ...this.config.P2P.BOOTSTRAP_NODES,
            ...this.defaultBootstrapNodes,
            ...this.config.P2P.NODES,
            ...this.config.P2P.PRIVATE_NODES,
        ]);
        return Array.from(peers);
    }

    private initializeBootstrapPeerIds(): void {
        const bootstrapList = [...this.config.P2P.BOOTSTRAP_NODES, ...this.defaultBootstrapNodes];

        for (const bootstrapAddr of bootstrapList) {
            try {
                const addr = multiaddr(bootstrapAddr);
                const addrStr = addr.toString();
                const p2pMatch = addrStr.match(/\/(p2p|ipfs)\/([^/]+)/);
                if (p2pMatch && p2pMatch[2]) {
                    this.bootstrapPeerIds.add(p2pMatch[2]);
                }
            } catch (e) {
                if (Config.DEV_MODE) {
                    console.error(`Invalid multiaddr format: ${bootstrapAddr}`);
                }
            }
        }
    }

    private getDefaultBootstrapNodes(): string[] {
        const bootstrapNodes =
            BootstrapNodes[this.config.BITCOIN.CHAIN_ID]?.[this.config.BITCOIN.NETWORK];

        if (bootstrapNodes) {
            return bootstrapNodes;
        }

        console.warn(
            `!!! --- No bootstrap nodes found for chain ${this.config.BITCOIN.CHAIN_ID} and network ${this.config.BITCOIN.NETWORK} --- !!!`,
        );

        return [];
    }

    private createDirIfNotExists(dir: string): void {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    private loadPeer(): BackedUpPeer | undefined {
        try {
            const lastPeerIdentity = fs.readFileSync(this.peerFilePath());
            const decrypted = this.decryptToString(new Uint8Array(lastPeerIdentity));
            const decoded = JSON.parse(decrypted) as {
                id: string;
                privKey: string | Buffer;
                pubKey: string;
            };
            decoded.privKey = Buffer.from(decoded.privKey as string, 'base64');
            return decoded as BackedUpPeer;
        } catch (e) {
            const error = e as Error;
            if (error.message.includes('no such file or directory')) {
                return;
            }
            if (Config.DEV_MODE) {
                console.error(e);
            }
        }
        return;
    }

    private getDataStorePath(): string {
        return path.join(this.getBinPath(), 'datastore');
    }

    private peerFilePath(): string {
        return path.join(this.getBinPath(), `identity.bin`);
    }

    private uint8ArrayToString(uint8Array: Uint8Array): string {
        return Buffer.from(uint8Array).toString('base64');
    }
}
