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
import { multiaddr } from '@multiformats/multiaddr';

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

    constructor(private readonly config: BtcIndexerConfig) {
        super();

        this.defaultBootstrapNodes = this.getDefaultBootstrapNodes();
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

            initialStreamWindowSize: 256 * 1024, // 256 KB

            maxStreamWindowSize: P2PConfigurations.maxMessageSize,
        };
    }

    /*public get websocketConfiguration(): WebSocketsInit {
        return {
            websocket: {
                handshakeTimeout: 10000,
                maxPayload: P2PConfigurations.maxMessageSize,
            },
        };
    }

    public get autoNATConfiguration(): AutoNATServiceInit {
        return {
            protocolPrefix: P2PConfigurations.protocolName,
            timeout: 10000,
            maxInboundStreams: 5,
            maxOutboundStreams: 5,
            startupDelay: 4000,
            maxMessageSize: P2PConfigurations.maxMessageSize,
            refreshInterval: 30000,
        };
    }*/

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

        return {
            listen: listenAt,
        };
    }

    public get bootstrapConfiguration(): BootstrapInit {
        return {
            timeout: 15000,
            tagValue: 50,
            tagTTL: 120000,
            list: this.getBootstrapPeers(),
        };
    }

    public get multicastDnsConfiguration(): MulticastDNSInit {
        return {
            interval: 1000,
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
        return {};
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
        };
    }

    public get identifyConfiguration(): IdentifyInit {
        return {
            protocolPrefix: P2PConfigurations.protocolName,
            timeout: 10000,
            maxInboundStreams: 5,
            maxOutboundStreams: 5,
            maxObservedAddresses: 1,
            runOnConnectionOpen: false,
        };
    }

    public get protocol(): string {
        return `${P2PConfigurations.protocolName}/op/${P2PMajorVersion}`;
    }

    public isBootstrapPeer(peerId: string): boolean {
        // Check if this peer ID matches any known bootstrap nodes
        const bootstrapList = [...this.config.P2P.BOOTSTRAP_NODES, ...this.defaultBootstrapNodes];

        // Bootstrap nodes in the config are in multiaddr format
        // Extract peer IDs from them
        for (const bootstrapAddr of bootstrapList) {
            try {
                const addr = multiaddr(bootstrapAddr);
                const peerIdFromAddr = addr.getPeerId();
                if (peerIdFromAddr && peerIdFromAddr === peerId) {
                    return true;
                }
            } catch {
                // Invalid multiaddr format, skip
            }
        }

        return false;
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
            fs.mkdirSync(dir, {
                recursive: true,
            });
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

    private getBootstrapPeers(): string[] {
        return [...this.config.P2P.BOOTSTRAP_NODES, ...this.defaultBootstrapNodes];
    }
}
