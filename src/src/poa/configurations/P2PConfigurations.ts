import { YamuxMuxerInit } from '@chainsafe/libp2p-yamux';
import { BootstrapInit } from '@libp2p/bootstrap';
import { IdentifyInit } from '@libp2p/identify';

import { NodeInfo, PeerId } from '@libp2p/interface';
import { FaultTolerance } from '@libp2p/interface-transport';
import { KadDHTInit } from '@libp2p/kad-dht';
import { MulticastDNSInit } from '@libp2p/mdns/dist/src/mdns.js';
import { MplexInit } from '@libp2p/mplex';
import { createFromJSON } from '@libp2p/peer-id-factory';
import type { PersistentPeerStoreInit } from '@libp2p/peer-store';
import { TCPOptions } from '@libp2p/tcp';
import { UPnPNATInit } from '@libp2p/upnp-nat';
import { WebSocketsInit } from '@libp2p/websockets';
import { LevelDatastore } from 'datastore-level';
import fs from 'fs';
import { AddressManagerInit } from 'libp2p/address-manager/index.js';
import { ConnectionManagerInit } from 'libp2p/connection-manager/index.js';
import { TransportManagerInit } from 'libp2p/transport-manager.js';

import path from 'path';

import { BtcIndexerConfig } from '../../config/BtcIndexerConfig.js';
import { PeerToPeerMethod } from '../../config/interfaces/PeerToPeerMethod.js';
import { OPNetPathFinder } from '../identity/OPNetPathFinder.js';
import { P2PVersion } from './P2PVersion.js';

interface BackedUpPeer {
    id: string;
    privKey?: string;
    pubKey?: string;
}

export class P2PConfigurations extends OPNetPathFinder {
    public static readonly protocolName: string = 'opnet';
    public static readonly protocolVersion: string = '1.0.0';

    private static readonly defaultBootstrapNodes: string[] = [
        '/ip4/51.81.67.34/tcp/9800/p2p/12D3KooWR6md7NNX8NAd3HNQiqNRVCTbrBbL4ExBFAfGapAWvY5U',
    ];

    private static readonly maxMessageSize: number = 8 * 1024 * 1024; // 8 MiB

    constructor(private readonly config: BtcIndexerConfig) {
        super();
    }

    public get tcpConfiguration(): TCPOptions {
        return {
            inboundSocketInactivityTimeout: this.config.P2P.PEER_INACTIVITY_TIMEOUT,
            outboundSocketInactivityTimeout: this.config.P2P.PEER_INACTIVITY_TIMEOUT,

            maxConnections: this.config.P2P.MAXIMUM_PEERS,
        };
    }

    public get websocketConfiguration(): WebSocketsInit {
        return {
            websocket: {
                handshakeTimeout: 10000,
                maxPayload: P2PConfigurations.maxMessageSize,
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
        };
    }

    public get mplexConfiguration(): MplexInit {
        return {
            /**
             * The total number of inbound protocol streams that can be opened on a given connection
             */
            maxInboundStreams: this.config.P2P.MAXIMUM_INBOUND_STREAMS,

            /**
             * The total number of outbound protocol streams that can be opened on a given connection
             */
            maxOutboundStreams: this.config.P2P.MAXIMUM_OUTBOUND_STREAMS,

            /**
             * How much incoming data in bytes to buffer while attempting to parse messages - peers sending many small messages in batches may cause this buffer to grow
             */
            maxUnprocessedMessageQueueSize: 100,

            /**
             * How much message data in bytes to buffer after parsing - slow stream consumers may cause this buffer to grow
             */
            maxStreamBufferSize: P2PConfigurations.maxMessageSize,

            /**
             * Mplex does not support backpressure so to protect ourselves, if `maxInboundStreams` is
             * hit and the remote opens more than this many streams per second, close the connection
             */
            disconnectThreshold: 15,
        };
    }

    public get listeningConfiguration(): AddressManagerInit {
        const listenAt: string[] = [];
        const port = this.config.P2P.P2P_PORT ?? 0;
        const host = this.config.P2P.P2P_HOST ?? '0.0.0.0';
        const protocol = this.config.P2P.P2P_PROTOCOL ?? PeerToPeerMethod.TCP;

        listenAt.push(`/ip4/${host}/${protocol}/${port}`);

        if (this.config.P2P.ENABLE_IPV6) {
            let host = this.config.P2P.P2P_HOST_V6 ?? '::';
            let port = this.config.P2P.P2P_PORT_V6 ?? 0;

            listenAt.push(`/ip6/${host}/${protocol}/${port}`);
        }

        return {
            listen: listenAt,
        };
    }

    public get bootstrapConfiguration(): BootstrapInit {
        return {
            timeout: 10000,
            list: this.getBootstrapPeers(),
        };
    }

    public get multicastDnsConfiguration(): MulticastDNSInit {
        return {
            interval: 20000,
        };
    }

    public get connectionManagerConfiguration(): ConnectionManagerInit {
        return {
            /**
             * A remote peer may attempt to open up to this many connections per second,
             * any more than that will be automatically rejected
             */
            inboundConnectionThreshold: 20,

            /**
             * The total number of connections allowed to be open at one time
             */
            maxConnections: this.config.P2P.MAXIMUM_PEERS,

            /**
             * If the number of open connections goes below this number, the node
             * will try to connect to randomly selected peers from the peer store
             */
            minConnections: this.config.P2P.MINIMUM_PEERS,

            /**
             * How many connections can be open but not yet upgraded
             */
            maxIncomingPendingConnections: this.config.P2P.MAXIMUM_INCOMING_PENDING_PEERS,
        };
    }

    public get peerStoreConfiguration(): PersistentPeerStoreInit {
        return {};
    }

    public get nodeConfigurations(): NodeInfo {
        return {
            name: `${P2PConfigurations.protocolName}/${P2PVersion}`,
            version: P2PConfigurations.protocolVersion,
        };
    }

    public get transportManagerConfiguration(): TransportManagerInit {
        return {
            faultTolerance: FaultTolerance.NO_FATAL,
        };
    }

    public get upnpConfiguration(): UPnPNATInit {
        return {
            description: P2PConfigurations.protocolName,
            ttl: 7200,
            keepAlive: true,
        };
    }

    public get dhtConfiguration(): KadDHTInit {
        return {
            kBucketSize: 20,
            pingTimeout: 10000,
            clientMode: false,
            protocol: this.protocol,
        };
    }

    public get identifyConfiguration(): IdentifyInit {
        return {
            protocolPrefix: P2PConfigurations.protocolName,
            agentVersion: P2PVersion,
            timeout: 10000,
            runOnConnectionOpen: true,
        };
    }

    public get protocol(): string {
        return `${P2PConfigurations.protocolName}/op/${P2PVersion}`;
    }

    public async peerIdConfigurations(): Promise<PeerId | undefined> {
        const thisPeer = this.loadPeer();

        if (!thisPeer) {
            return;
        }

        return await createFromJSON(thisPeer);
    }

    public savePeer(peer: PeerId): void {
        if (!peer.privateKey) {
            throw new Error('Peer does not have a private key.');
        }

        if (!peer.publicKey) {
            throw new Error('Peer does not have a public key.');
        }

        const peerIdentity: BackedUpPeer = {
            id: peer.toString(),
            privKey: this.uint8ArrayToString(peer.privateKey),
            pubKey: this.uint8ArrayToString(peer.publicKey),
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

            return JSON.parse(decrypted);
        } catch (e) {
            const error = e as Error;
            if (error.message.includes('no such file or directory')) {
                return;
            }

            console.log(e);
        }

        return;
    }

    private getDataStorePath(): string {
        return path.join(this.getBinPath(), 'datastore');
    }

    private peerFilePath(): string {
        return path.join(this.getBinPath(), 'identity.bin');
    }

    private uint8ArrayToString(uint8Array: Uint8Array): string {
        return Buffer.from(uint8Array).toString('base64');
    }

    private getBootstrapPeers(): string[] {
        return [...this.config.P2P.BOOTSTRAP_NODES, ...P2PConfigurations.defaultBootstrapNodes];
    }
}
