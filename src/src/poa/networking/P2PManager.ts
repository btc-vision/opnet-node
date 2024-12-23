import { DebugLevel, Logger } from '@btc-vision/bsi-common';
import { yamux } from '@chainsafe/libp2p-yamux';
import { bootstrap, BootstrapComponents } from '@libp2p/bootstrap';
import { Identify, identify, IdentifyPush, identifyPush } from '@libp2p/identify';
import {
    type ConnectionGater,
    Peer,
    PeerDiscovery,
    PeerId,
    PeerInfo,
    PeerUpdate,
    PrivateKey,
} from '@libp2p/interface';
import { IdentifyResult } from '@libp2p/interface/src';
import type { Connection, MultiaddrConnection } from '@libp2p/interface/src/connection/index.js';
import { PeerData } from '@libp2p/interface/src/peer-store/index.js';
import { IncomingStreamData } from '@libp2p/interface/src/stream-handler/index.js';
import { KadDHT, kadDHT } from '@libp2p/kad-dht';
import { mdns } from '@libp2p/mdns';
import { MulticastDNSComponents } from '@libp2p/mdns/dist/src/mdns.js';
import { peerIdFromCID, peerIdFromString } from '@libp2p/peer-id';
import type { PersistentPeerStoreInit } from '@libp2p/peer-store';
import { tcp } from '@libp2p/tcp';
import { uPnPNAT } from '@libp2p/upnp-nat';
import { multiaddr, Multiaddr } from '@multiformats/multiaddr';
import figlet, { Fonts } from 'figlet';
import type { Datastore } from 'interface-datastore';
import { lpStream } from 'it-length-prefixed-stream';
import { createLibp2p, Libp2p } from 'libp2p';
import { BtcIndexerConfig } from '../../config/BtcIndexerConfig.js';
import { DBManagerInstance } from '../../db/DBManager.js';
import { MessageType } from '../../threading/enum/MessageType.js';
import { BlockProcessedData } from '../../threading/interfaces/thread-messages/messages/indexer/BlockProcessed.js';
import {
    StartIndexer,
    StartIndexerResponseData,
} from '../../threading/interfaces/thread-messages/messages/indexer/StartIndexer.js';
import { ThreadMessageBase } from '../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../../threading/interfaces/ThreadData.js';
import { ThreadTypes } from '../../threading/thread/enums/ThreadTypes.js';
import { P2PConfigurations } from '../configurations/P2PConfigurations.js';
import { CommonHandlers } from '../events/CommonHandlers.js';
import { OPNetIdentity } from '../identity/OPNetIdentity.js';
import { OPNetPeer } from '../peer/OPNetPeer.js';
import { DisconnectionCode } from './enums/DisconnectionCode.js';
import { BlockWitnessManager } from './p2p/BlockWitnessManager.js';
import { IBlockHeaderWitness } from './protobuf/packets/blockchain/common/BlockHeaderWitness.js';
import { ITransactionPacket } from './protobuf/packets/blockchain/common/TransactionPacket.js';
import { OPNetPeerInfo } from './protobuf/packets/peering/DiscoveryResponsePacket.js';
import { AuthenticationManager } from './server/managers/AuthenticationManager.js';
import {
    BroadcastOPNetRequest,
    OPNetBroadcastData,
    OPNetBroadcastResponse,
} from '../../threading/interfaces/thread-messages/messages/api/BroadcastTransactionOPNet.js';
import { BroadcastResponse } from '../../threading/interfaces/thread-messages/messages/api/BroadcastRequest.js';
import { RPCMessage } from '../../threading/interfaces/thread-messages/messages/api/RPCMessage.js';
import { BitcoinRPCThreadMessageType } from '../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { shuffleArray, TrustedAuthority } from '../configurations/manager/TrustedAuthority.js';
import { AuthorityManager } from '../configurations/manager/AuthorityManager.js';
import { xxHash } from '../hashing/xxhash.js';
import { OPNetConsensus } from '../configurations/OPNetConsensus.js';
import { Components } from 'libp2p/components.js';
import { Config } from '../../config/Config.js';
import { noise } from '@chainsafe/libp2p-noise';
import { CID } from 'multiformats/cid';

type BootstrapDiscoveryMethod = (components: BootstrapComponents) => PeerDiscovery;

export interface OPNetConnectionInfo {
    peerId: PeerId;
    agentVersion: string;
    protocolVersion: string;
}

interface BlacklistedPeerInfo {
    reason: DisconnectionCode;
    timestamp: number;
    attempts: number;
}

type Libp2pInstance = Libp2p<{
    nat: unknown;
    kadDHT: KadDHT;
    identify: Identify;
    identifyPush: IdentifyPush;
}>;

export class P2PManager extends Logger {
    public readonly logColor: string = '#00ffe1';

    private readonly p2pConfigurations: P2PConfigurations;
    private node: Libp2pInstance | undefined;

    private privateKey: PrivateKey | undefined;

    private peers: Map<string, OPNetPeer> = new Map();

    private blackListedPeerIds: Map<string, BlacklistedPeerInfo> = new Map();
    private blackListedPeerIps: Map<string, BlacklistedPeerInfo> = new Map();

    private knownMempoolIdentifiers: Set<bigint> = new Set();
    private broadcastIdentifiers: Set<bigint> = new Set();

    private readonly PURGE_BLACKLISTED_PEER_AFTER: number = 30_000;

    private readonly identity: OPNetIdentity;
    private startedIndexer: boolean = false;

    private readonly blockWitnessManager: BlockWitnessManager;
    private readonly currentAuthority: TrustedAuthority = AuthorityManager.getCurrentAuthority();

    constructor(private readonly config: BtcIndexerConfig) {
        super();

        this.p2pConfigurations = new P2PConfigurations(this.config);
        this.identity = new OPNetIdentity(this.config, this.currentAuthority);

        this.blockWitnessManager = new BlockWitnessManager(this.config, this.identity);
        this.blockWitnessManager.broadcastBlockWitness = this.broadcastBlockWitness.bind(this);
        this.blockWitnessManager.sendMessageToThread = this.internalSendMessageToThread.bind(this);

        this.addConsensusHandlers();

        setInterval(() => {
            this.knownMempoolIdentifiers.clear();
            this.broadcastIdentifiers.clear();

            this.purgeOldBlacklistedPeers();
        }, 10_000);
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

    public sendMessageToThread: (
        threadType: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ) => Promise<ThreadData | null> = () => {
        throw new Error('sendMessageToThread not implemented.');
    };

    public async generateBlockHeaderProof(
        data: BlockProcessedData,
        isSelf: boolean = false,
    ): Promise<void> {
        // Generate block witness.
        await this.blockWitnessManager.generateBlockHeaderProof(data, isSelf);

        // Request block witnesses from peers.
        if (data.blockNumber - 1n > 0n) {
            await this.requestBlockWitnessesFromPeer(data.blockNumber - 1n);
        }

        await this.requestBlockWitnessesFromPeer(data.blockNumber);
    }

    public async init(): Promise<void> {
        DBManagerInstance.setup();
        await DBManagerInstance.connect();

        this.blockWitnessManager.init();
        await this.blockWitnessManager.setCurrentBlock();

        this.node = await this.createNode();

        this.addListeners();
        await this.startNode();
        await this.addHandles();

        await this.onStarted();
    }

    public override info(...args: string[]): void {
        if (this.config.DEBUG_LEVEL < DebugLevel.INFO) {
            return;
        }

        super.info(...args);
    }

    public async broadcastTransaction(data: OPNetBroadcastData): Promise<OPNetBroadcastResponse> {
        if (this.broadcastIdentifiers.has(data.identifier) && data.identifier) {
            this.warn(`Transaction already broadcast.`);

            return {
                peers: 0,
            };
        }

        if (data.identifier) this.broadcastIdentifiers.add(data.identifier);

        return {
            peers: await this.broadcastMempoolTransaction({
                transaction: data.raw,
                psbt: data.psbt,
                identifier: data.identifier,
            }),
        };
    }

    public async getOPNetPeers(): Promise<OPNetPeerInfo[]> {
        if (!this.node) throw new Error('Node not initialized');

        const peers: OPNetPeerInfo[] = [];
        const peersData: Peer[] = await this.node.peerStore.all();

        for (const peerData of peersData) {
            const peer = this.peers.get(peerData.id.toString());
            if (!peer) continue;

            if (!peer.hasAuthenticated) continue;
            if (peer.clientVersion === undefined) continue;
            if (peer.clientChecksum === undefined) continue;
            if (peer.clientIdentity === undefined) continue;
            if (peer.clientIndexerMode === undefined) continue;
            if (peer.clientChainId === undefined) continue;
            if (peer.clientNetwork === undefined) continue;

            // filter out self
            const thisNodeAddr = this.node.peerId.toString();
            const addresses = peerData.addresses
                .map((addr) => {
                    if (addr.multiaddr.toString().includes(thisNodeAddr)) return null;
                    if (addr.isCertified) return null; // Skip certified addresses.

                    return addr.multiaddr.bytes;
                })
                .filter((addr) => !!addr);

            if (addresses.length === 0) continue;

            const peerInfo: OPNetPeerInfo = {
                opnetVersion: peer.clientVersion,
                identity: peer.clientIdentity,
                type: peer.clientIndexerMode,
                network: peer.clientNetwork,
                chainId: peer.clientChainId,
                peer: peerData.id.toCID().bytes,
                addresses: addresses,
            };

            peers.push(peerInfo);
        }

        // Apply shuffle to the peers list, way to not be "predictable" and re-identified by the same peers.
        shuffleArray(peers);

        return peers;
    }

    private purgeOldBlacklistedPeers(): void {
        const now = Date.now();
        for (const [peerId, info] of this.blackListedPeerIds) {
            if (now - info.timestamp > this.PURGE_BLACKLISTED_PEER_AFTER) {
                this.blackListedPeerIds.delete(peerId);
            }
        }

        for (const [peerId, info] of this.blackListedPeerIps) {
            if (now - info.timestamp > this.PURGE_BLACKLISTED_PEER_AFTER) {
                this.blackListedPeerIps.delete(peerId);
            }
        }
    }

    private addConsensusHandlers(): void {
        OPNetConsensus.addConsensusUpgradeCallback((consensusName: string, isReady: boolean) => {
            if (!isReady) {
                this.panic(
                    `!!!!!!!!!!!!!! -------------------- FATAL. Consensus upgrade failed. This node is not ready to apply ${consensusName}. -------------------- !!!!!!!!!!!!!!`,
                );

                this.panic(
                    `PoC has been disabled. This node will not connect to any peers. And any processing will be halted.`,
                );

                this.notifyArt(
                    `warn`,
                    `FATAL.`,
                    'Doh',
                    `\n\n\n!!!!!!!!!! -------------------- UPGRADE FAILED. --------------------  !!!!!!!!!!\n\n\n\n\n`,
                    `\n\nPoC has been disabled. This node will not connect to any peers. And any processing will be halted.\n`,
                    `This node is not ready to apply ${consensusName}.\n`,
                    `UPGRADE IMMEDIATELY.\n\n`,
                );

                setTimeout(() => {
                    process.exit(1); // Exit the process.
                }, 2000);

                return;
            }

            this.notifyArt(
                'success',
                consensusName,
                'Doh',
                `\n\n\n!!!!!!!!!! -------------------- CONSENSUS UPGRADE. --------------------  !!!!!!!!!!\n\n\n\n\n`,
                `\n\nOPNet consensus ${consensusName} is now enforced.\n`,
                `This node is now enforcing the ${consensusName} consensus rules. Any peers that do not comply will be disconnected.\n`,
            );
        });
    }

    private async broadcastMempoolTransaction(
        transaction: ITransactionPacket & {
            identifier: bigint;
        },
    ): Promise<number> {
        const broadcastPromises: Promise<void>[] = [];
        for (const peer of this.peers.values()) {
            if (!peer.isAuthenticated) continue;

            broadcastPromises.push(peer.broadcastMempoolTransaction(transaction));
        }

        await Promise.all(broadcastPromises);

        return broadcastPromises.length;
    }

    private async requestBlockWitnessesFromPeer(blockNumber: bigint): Promise<void> {
        const promises: Promise<void>[] = [];
        for (const [_peerId, peer] of this.peers) {
            if (!peer.isAuthenticated) continue;

            promises.push(peer.requestBlockWitnessesFromPeer(blockNumber));
        }

        await Promise.all(promises);
    }

    private internalSendMessageToThread(
        threadType: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | null> {
        return this.sendMessageToThread(threadType, m);
    }

    private async broadcastBlockWitness(blockWitness: IBlockHeaderWitness): Promise<void> {
        if (this.peers.size === 0) {
            return;
        }

        let generatedWitness: Uint8Array | undefined;
        for (const [_peerId, peer] of this.peers) {
            if (!peer.isAuthenticated) continue;

            generatedWitness = peer.generateWitnessToBroadcast(blockWitness);
            if (generatedWitness) break;
        }

        if (!generatedWitness) {
            this.error('Failed to generate block witness. Will not broadcast.');
            return;
        }

        // send to all peers
        const promises: Promise<void>[] = [];
        for (const [_peerId, peer] of this.peers) {
            if (!peer.isAuthenticated) continue;

            promises.push(peer.sendFromServer(generatedWitness));
        }

        await Promise.all(promises);
    }

    private isBootstrapNode(): boolean {
        return this.config.P2P.IS_BOOTSTRAP_NODE;
    }

    private addListeners(): void {
        if (this.node === undefined) {
            throw new Error('Node not initialized');
        }

        this.node.addEventListener('peer:discovery', this.onPeerDiscovery.bind(this));
        this.node.addEventListener('peer:disconnect', this.onPeerDisconnect.bind(this));
        this.node.addEventListener('peer:update', this.onPeerUpdate.bind(this));
        this.node.addEventListener('peer:connect', this.onPeerConnect.bind(this));
        this.node.addEventListener('peer:identify', this.onPeerIdentify.bind(this));
    }

    private async onPeerIdentify(evt: CustomEvent<IdentifyResult>): Promise<void> {
        if (!this.node) throw new Error('Node not initialized');

        const peerInfo: IdentifyResult = evt.detail;
        const peerData: PeerData = {
            multiaddrs: peerInfo.listenAddrs,
        };

        await this.node.peerStore.merge(peerInfo.peerId, peerData);
        this.info(`Identified peer: ${peerInfo.peerId.toString()}`);
    }

    private async refreshRouting(): Promise<void> {
        if (!this.node) throw new Error('Node not initialized');

        await this.node.services.kadDHT.refreshRoutingTable();
    }

    private onPeerDiscovery(evt: CustomEvent<PeerInfo>): void {
        const peerId = evt.detail.id.toString();

        this.info(`Discovered peer: ${peerId}`);
    }

    private async onPeerDisconnect(evt: CustomEvent<PeerId>): Promise<void> {
        const peerId = evt.detail.toString();

        const peer = this.peers.get(peerId);
        if (peer) {
            this.peers.delete(peerId);

            await peer.onDisconnect();
        }
    }

    private async onPeerUpdate(_evt: CustomEvent<PeerUpdate>): Promise<void> {}

    private async createPeer(peerInfo: OPNetConnectionInfo, peerIdStr: string): Promise<void> {
        if (this.peers.has(peerIdStr)) {
            throw new Error(`Peer (client) ${peerIdStr} already exists. Memory leak detected.`);
        }

        const peer: OPNetPeer = new OPNetPeer(peerInfo, this.identity);
        /** Convert all these to event listeners. */
        peer.disconnectPeer = this.disconnectPeer.bind(this);
        peer.sendMsg = this.sendToPeer.bind(this);
        peer.reportAuthenticatedPeer = this.reportAuthenticatedPeer.bind(this);
        peer.getOPNetPeers = this.getOPNetPeers.bind(this);
        peer.onBlockWitness = this.blockWitnessManager.onBlockWitness.bind(
            this.blockWitnessManager,
        );
        peer.onBlockWitnessResponse = this.blockWitnessManager.onBlockWitnessResponse.bind(
            this.blockWitnessManager,
        );
        peer.onPeersDiscovered = this.onOPNetPeersDiscovered.bind(this);
        peer.requestBlockWitnesses = this.blockWitnessManager.requestBlockWitnesses.bind(
            this.blockWitnessManager,
        );
        /** ------------------------------- */

        peer.on(CommonHandlers.MEMPOOL_BROADCAST, this.onBroadcastTransaction.bind(this));

        this.peers.set(peerIdStr, peer);

        await peer.init();
    }

    private async onBroadcastTransaction(tx: ITransactionPacket): Promise<void> {
        const verifiedTransaction = await this.verifyOPNetTransaction(
            tx.transaction,
            tx.psbt,
            xxHash.hash(
                Buffer.isBuffer(tx.transaction) ? tx.transaction : Buffer.from(tx.transaction),
            ),
        );

        if (!verifiedTransaction || !verifiedTransaction.success) {
            // Failed to verify transaction.
            return;
        }

        if (verifiedTransaction.peers) {
            // Already broadcasted via the verification process.
            return;
        }

        const identifier =
            verifiedTransaction.identifier || xxHash.hash(Buffer.from(tx.transaction));
        const modifiedTransaction: Uint8Array = verifiedTransaction.modifiedTransaction
            ? Buffer.from(verifiedTransaction.modifiedTransaction, 'base64')
            : tx.transaction;

        const isPsbt: boolean = tx.psbt ? !verifiedTransaction.finalizedTransaction : false;

        /** Already broadcasted. */
        if (this.knownMempoolIdentifiers.has(identifier)) {
            //this.info(`Transaction ${identifier} already known.`);
            return;
        }

        this.info(`Transaction ${identifier} entered mempool.`);
        this.knownMempoolIdentifiers.add(identifier);

        const broadcastData: OPNetBroadcastData = {
            raw: modifiedTransaction,
            psbt: isPsbt,
            identifier: identifier,
        };

        await this.broadcastTransaction(broadcastData);
    }

    private async verifyOPNetTransaction(
        data: Uint8Array,
        psbt: boolean,
        identifier: bigint,
    ): Promise<BroadcastResponse | undefined> {
        const currentBlockMsg: RPCMessage<BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET> =
            {
                type: MessageType.RPC_METHOD,
                data: {
                    rpcMethod: BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET,
                    data: {
                        raw: data,
                        psbt,
                        identifier,
                    },
                } as BroadcastOPNetRequest,
            };

        return (await this.sendMessageToThread(ThreadTypes.MEMPOOL, currentBlockMsg)) as
            | BroadcastResponse
            | undefined;
    }

    private async onOPNetPeersDiscovered(peers: OPNetPeerInfo[]): Promise<void> {
        if (!this.node) throw new Error('Node not initialized');

        const discovered: string[] = [];
        const peersToTry: PeerInfo[] = [];
        for (let peer = 0; peer < peers.length; peer++) {
            const peerInfo: OPNetPeerInfo = peers[peer];

            try {
                const peerId = peerIdFromCID(CID.decode(peerInfo.peer));
                if (!peerId.toString()) continue;

                const peerIdStr = peerId.toString();
                if (discovered.includes(peerIdStr)) {
                    continue;
                }

                discovered.push(peerIdStr);

                if (this.isBlackListedPeerId(peerIdStr)) continue;

                // Is self.
                if (this.node.peerId.equals(peerId)) continue;

                if (peerInfo.addresses.length === 0) {
                    this.fail(`No addresses found for peer ${peerIdStr}`);
                    continue;
                }

                const addresses: Multiaddr[] = [];
                for (const address of peerInfo.addresses) {
                    const addr = multiaddr(address);

                    if (this.blackListedPeerIps.has(addr.nodeAddress().address)) continue;

                    addresses.push(addr);
                }

                if (addresses.length === 0) {
                    this.warn(`No valid addresses found for peer ${peerIdStr}`);
                    continue;
                }

                const peerData: PeerInfo = {
                    id: peerIdFromString(peerIdStr),
                    multiaddrs: addresses,
                };

                peersToTry.push(peerData);
            } catch (e) {
                this.error(`Error while adding peer to try: ${(e as Error).message}`);
            }
        }

        if (peersToTry.length === 0) {
            return;
        }

        const maxPerBatch = 10;
        for (let i = 0; i < peersToTry.length; i += maxPerBatch) {
            const batch = peersToTry.slice(i, i + maxPerBatch);
            const promises: Promise<Peer>[] = [];

            for (const peerData of batch) {
                const addedPeer = this.node.peerStore.merge(peerData.id, {
                    multiaddrs: peerData.multiaddrs,
                    tags: {
                        ['OPNET']: {
                            value: 50,
                            ttl: 128000,
                        },
                    },
                });

                promises.push(addedPeer);
            }

            await Promise.all(promises);
        }
    }

    private reportAuthenticatedPeer(_peerId: PeerId): void {
        this.logOPNetInfo();
    }

    private logOPNetInfo(): void {
        if (!this.startedIndexer) {
            this.startedIndexer = true;

            this.notifyArt(
                'info',
                'OPNet',
                'Doh',
                `\n\n\nPoC enabled. At least one peer was found! You are now connected to,\n\n\n\n\n`,
                `\nThis node bitcoin address is ${this.identity.pubKey} or ${this.identity.tapAddress} (taproot) or ${this.identity.segwitAddress} (segwit).\n`,
                `Your OPNet identity is ${this.identity.opnetAddress}.\n`,
                `Your OPNet trusted certificate is\n${this.identity.trustedPublicKey}\n`,
                `Looking for peers...\n\n`,
            );

            if (!this.isBootstrapNode()) this.startIndexing();
        }
    }

    private startIndexing(): void {
        // We use a delay here, so it allow the user to view their peer information. This delay is not required.
        setTimeout(async () => {
            const startupMessage: StartIndexer = {
                type: MessageType.START_INDEXER,
                data: {},
            };

            const resp = (await this.sendMessageToThread(
                ThreadTypes.INDEXER,
                startupMessage,
            )) as StartIndexerResponseData | null;

            if (resp && resp.started) {
                this.info(`Indexer started successfully.`);
            } else {
                this.fail(`Failed to start indexer.`);
            }
        }, 5000);
    }

    private async blackListPeerId(peerId: PeerId, reason: DisconnectionCode): Promise<void> {
        if (!this.blackListedPeerIds.has(peerId.toString())) {
            this.blackListedPeerIds.set(peerId.toString(), {
                reason,
                timestamp: Date.now(),
                attempts: 0,
            });
        }

        try {
            if (this.node) {
                const peer = await this.node.peerStore.get(peerId);

                if (peer) {
                    this.blacklistPeerIps(peer, reason);
                    await this.node.peerStore.delete(peerId);
                }
            }
        } catch (e) {}
    }

    private onStarted(): Promise<void> {
        if (!this.node) {
            throw new Error('Node not initialized');
        }

        this.success('P2PManager initialized. Looking for peers...');

        if (this.isBootstrapNode()) {
            this.notifyArt(
                'info',
                'OPNet Bootstrap Node',
                'Big Money-sw',
                `\n\n\nThis node is a,\n\n\n\n\n`,
                `\n\nThis node is running in bootstrap mode. This means it will not connect to other peers automatically. It will only accept incoming connections.\n`,
                `This node bitcoin address is ${this.identity.pubKey} or ${this.identity.tapAddress} (taproot) or ${this.identity.segwitAddress} (segwit).\n`,
                `Your OPNet identity is ${this.identity.opnetAddress}.\n`,
                `Your OPNet trusted certificate is\n${this.identity.trustedPublicKey}\n\n`,
            );

            this.startIndexing();
        }

        if (this.config.DEV_MODE) {
            const addresses = this.multiAddresses;
            for (const address of addresses) {
                this.info(`Listening on ${address.toString()}`);
            }
        }

        if (!this.privateKey) {
            throw new Error('Private key not set');
        }

        this.p2pConfigurations.savePeer(this.node.peerId, this.privateKey);

        return this.refreshRouting();
    }

    private notifyArt(
        type: 'info' | 'warn' | 'success' | 'panic',
        text: string,
        font: Fonts,
        prefix: string,
        ...suffix: string[]
    ): void {
        const artVal = figlet.textSync(text, {
            font: font, //'Doh',
            horizontalLayout: 'default',
            verticalLayout: 'default',
        });

        this[type](`${prefix}${artVal}${suffix.join('\n')}`);
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
        const info = this.blackListedPeerIds.get(id);
        if (info) {
            if (info.reason === DisconnectionCode.RECONNECT) {
                this.blackListedPeerIds.delete(id);
            } else {
                if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                    this.debug(
                        `Peer ${id} is blacklisted due to ${info.reason}. Flushing connection...`,
                    );
                }

                return false;
            }
        }

        return true;
    }

    private async disconnectPeer(
        peerId: PeerId,
        code: DisconnectionCode = DisconnectionCode.RECONNECT,
        _reason?: string,
    ): Promise<void> {
        if (this.node === undefined) {
            throw new Error('Node not initialized');
        }

        const peerStr = peerId.toString();
        if (code !== DisconnectionCode.RECONNECT && code !== DisconnectionCode.EXPECTED) {
            await this.blackListPeerId(peerId, code);
        } else if (code !== DisconnectionCode.EXPECTED) {
            const info = this.blackListedPeerIds.get(peerStr) || {
                reason: DisconnectionCode.RECONNECT,
                timestamp: Date.now(),
                attempts: 0,
            };

            if (info.timestamp < Date.now() - 30000) {
                info.attempts = 0;
            }

            info.attempts += 1;

            this.info(`Peer ${peerStr} disconnected. Reason: ${code}. Attempts: ${info.attempts}`);

            this.blackListedPeerIds.set(peerStr, info);
        }

        this.peers.delete(peerStr);

        await this.node.hangUp(peerId).catch((e: unknown) => {
            this.warn(`Error while hanging up peer: ${(e as Error).message}`);
        });
    }

    private blacklistPeerIps(peer: Peer, reason: DisconnectionCode): void {
        if (!this.config.P2P.ENABLE_IP_BANNING) {
            return;
        }

        const address = peer.addresses;

        if (address.length === 0) {
            return;
        }

        for (const addr of address) {
            const ip = addr.multiaddr.nodeAddress().address;
            if (ip && !this.blackListedPeerIps.has(ip)) {
                this.blackListedPeerIps.set(ip, {
                    reason,
                    timestamp: Date.now(),
                    attempts: 0,
                });
            }
        }
    }

    private async onPeerConnect(evt: CustomEvent<PeerId>): Promise<void> {
        const peerIdStr: string = evt.detail.toString();
        const peer = this.peers.get(peerIdStr);
        const peerId = peerIdFromString(peerIdStr);

        if (peer) {
            return await this.disconnectPeer(
                peerId,
                DisconnectionCode.BAD_BEHAVIOR,
                'Bad behavior.',
            );
        }

        if (this.blackListedPeerIds.size > 250) {
            return await this.disconnectPeer(peerId, DisconnectionCode.FLOOD, 'Flood.');
        }

        if (!peerId) {
            return await this.disconnectPeer(
                peerId,
                DisconnectionCode.BAD_BEHAVIOR,
                'Bad behavior.',
            );
        }

        const agent = `OPNet`;
        const version = `1.0.0`;

        if (!this.allowConnection(peerId, agent, version)) {
            this.warn(`Dropping connection to peer: ${peerIdStr} due to agent or version mismatch`);

            await this.blackListPeerId(peerId, DisconnectionCode.BAD_VERSION);
            return await this.disconnectPeer(peerId, DisconnectionCode.BAD_VERSION, 'Bad version.');
        }

        if (this.config.DEBUG_LEVEL >= DebugLevel.TRACE) {
            this.info(`Identified peer: ${peerIdStr} - Agent: ${agent} - Version: ${version}`);
        }

        await this.identifyPeer(peerId);
        await this.createPeer(
            {
                agentVersion: agent,
                protocolVersion: version,
                peerId: peerId,
            },
            peerIdStr,
        );
    }

    private async identifyPeer(peerId: PeerId): Promise<void> {
        if (!this.node) throw new Error('Node not initialized');

        const connection = this.getInboundConnectionForPeer(peerId);
        if (connection) {
            await this.node.services.identify.identify(connection).catch(() => {});
        }
    }

    private getInboundConnectionForPeer(peerId: PeerId): Connection | undefined {
        if (!this.node) {
            throw new Error('Node not initialized');
        }

        const connections = this.node.getConnections(peerId);
        if (connections.length === 0) {
            return undefined;
        }

        for (const conn of connections) {
            if (conn.direction === 'inbound') {
                return conn;
            }
        }
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
                if (this.config.DEBUG_LEVEL >= DebugLevel.TRACE) {
                    this.debug(
                        'Error while handling incoming stream',
                        (e as Error).stack as string,
                    );
                }
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

        await peer.onMessage(data.buffer);
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

            if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG && this.config.DEV_MODE) {
                this.error(
                    `Error while sending message to peer ${peerId.toString()}: ${Config.DEV_MODE ? error.stack : error.message}`,
                );
            }

            connection.abort(new Error(`Unexpected message received.`));
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

    // eslint-disable-next-line @typescript-eslint/require-await
    private async denyOutboundUpgradedConnection(
        peerId: PeerId,
        _maConn: MultiaddrConnection,
    ): Promise<boolean> {
        const id: string = peerId.toString();

        if (this.isBlackListedPeerId(peerId.toString())) {
            if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG && this.config.DEV_MODE) {
                this.debug(`[OUT] Peer ${id} is blacklisted. Flushing connection...`);
            }

            return true;
        }

        return false;
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    private async denyOutboundConnection(
        peerId: PeerId,
        _maConn: MultiaddrConnection,
    ): Promise<boolean> {
        const id: string = peerId.toString();

        if (this.isBlackListedPeerId(peerId.toString())) {
            if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                this.debug(`[OUT] Peer ${id} is blacklisted. Flushing connection...`);
            }

            return true;
        }

        return false;
    }

    private isBlackListedPeerId(peerId: string): boolean {
        const info = this.blackListedPeerIds.get(peerId);

        if (info && info.reason === DisconnectionCode.RECONNECT) {
            return info.attempts > 3;
        }

        return info !== undefined;
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    private async denyInboundConnection(_maConn: MultiaddrConnection): Promise<boolean> {
        return false;
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    private async denyInboundUpgradedConnection(
        peerId: PeerId,
        _maConn: MultiaddrConnection,
    ): Promise<boolean> {
        const id: string = peerId.toString();

        if (this.isBlackListedPeerId(peerId.toString())) {
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

    private peerStoreConfigurations(): PersistentPeerStoreInit {
        const baseConfigs = this.p2pConfigurations.peerStoreConfiguration;
        baseConfigs.addressFilter = this.addressFilter.bind(this);

        return baseConfigs;
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    private async addressFilter(peerId: PeerId, multiaddr: Multiaddr): Promise<boolean> {
        const peerIdStr: string = peerId.toString();
        const ip: string = multiaddr.nodeAddress().address;

        return !(this.isBlackListedPeerId(peerIdStr) || this.blackListedPeerIps.has(ip));
    }

    private async createNode(): Promise<Libp2pInstance> {
        this.privateKey = await this.p2pConfigurations.privateKeyConfigurations();

        const peerDiscovery: Partial<
            [(components: MulticastDNSComponents) => PeerDiscovery, BootstrapDiscoveryMethod]
        > = [];

        if (this.config.P2P.MDNS) {
            this.warn(
                `MDNS is enabled. This may cause issues with some networks. This might be vulnerable to DNS rebinding attacks.`,
            );
            peerDiscovery.push(mdns(this.p2pConfigurations.multicastDnsConfiguration));
        }

        if (this.p2pConfigurations.bootstrapConfiguration.list.length) {
            peerDiscovery.push(bootstrap(this.p2pConfigurations.bootstrapConfiguration));
        }

        const datastore = await this.getDatastore();
        return await createLibp2p({
            datastore: datastore,
            privateKey: this.privateKey,
            transports: [tcp(this.p2pConfigurations.tcpConfiguration)],
            connectionEncrypters: [noise()],
            connectionGater: this.getConnectionGater(),
            streamMuxers: [yamux(this.p2pConfigurations.yamuxConfiguration)],
            addresses: this.p2pConfigurations.listeningConfiguration,
            peerDiscovery: peerDiscovery as unknown as ((
                components: Components,
            ) => PeerDiscovery)[],
            nodeInfo: this.p2pConfigurations.nodeConfigurations,
            connectionManager: this.p2pConfigurations.connectionManagerConfiguration,
            peerStore: this.peerStoreConfigurations(),
            transportManager: this.p2pConfigurations.transportManagerConfiguration,
            services: {
                identify: identify(this.p2pConfigurations.identifyConfiguration),
                identifyPush: identifyPush(this.p2pConfigurations.identifyConfiguration),
                nat: uPnPNAT(this.p2pConfigurations.upnpConfiguration),
                kadDHT: kadDHT(this.p2pConfigurations.dhtConfiguration),
            },
        });
    }
}
