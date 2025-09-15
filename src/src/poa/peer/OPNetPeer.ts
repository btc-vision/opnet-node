import { DebugLevel, Logger } from '@btc-vision/bsi-common';
import { PeerId } from '@libp2p/interface';
import { Config } from '../../config/Config.js';
import { ChainIds } from '../../config/enums/ChainIds.js';
import { CommonHandlers } from '../events/CommonHandlers.js';
import { OPNetIdentity } from '../identity/OPNetIdentity.js';
import { ClientPeerNetworking } from '../networking/client/ClientPeerNetworking.js';
import { DisconnectionCode } from '../networking/enums/DisconnectionCode.js';
import { NetworkingEventHandler } from '../networking/interfaces/IEventHandler.js';
import { IBlockHeaderWitness } from '../networking/protobuf/packets/blockchain/common/BlockHeaderWitness.js';
import {
    ITransactionPacket,
    TransactionPacket,
} from '../networking/protobuf/packets/blockchain/common/TransactionPacket.js';
import {
    ISyncBlockHeaderResponse
} from '../networking/protobuf/packets/blockchain/responses/SyncBlockHeadersResponse.js';
import { OPNetPeerInfo } from '../networking/protobuf/packets/peering/DiscoveryResponsePacket.js';
import { ServerPeerNetworking } from '../networking/server/ServerPeerNetworking.js';
import { FastStringMap } from '../../utils/fast/FastStringMap.js';
import { OPNetIndexerMode } from '../../config/interfaces/OPNetIndexerMode.js';
import { OPNetConnectionInfo } from '../networking/interfaces/NodeType.js';

const PEER_DISCOVERY_TIMEOUT = 1000 * 60 * 2; // 2 minutes

export class OPNetPeer extends Logger {
    public isClientAuthenticated: boolean = false;
    public isServerAuthenticated: boolean = false;

    private readonly peerId: PeerId;
    private readonly peerIdString: string;

    private isDestroyed: boolean = false;

    private clientNetworkingManager: ClientPeerNetworking;
    private serverNetworkingManager: ServerPeerNetworking;

    private peerDiscoveryTimeout: NodeJS.Timeout | undefined;

    private eventHandlers: FastStringMap<NetworkingEventHandler[]> = new FastStringMap();
    private badPacketCount: number = 0;

    constructor(
        private _peerIdentity: OPNetConnectionInfo | undefined,
        private selfIdentity: OPNetIdentity | undefined,
    ) {
        super();

        this.peerId = this.peerIdentity.peerId;
        this.peerIdString = this.peerId.toString();

        this.serverNetworkingManager = new ServerPeerNetworking(
            this.peerIdString,
            this.selfIdentity,
        );

        this.defineServerNetworkingEvents();

        this.clientNetworkingManager = new ClientPeerNetworking(
            this.peerIdString,
            this.selfIdentity,
        );

        this.defineClientNetworkingEvents();
    }

    public get hasAuthenticated(): boolean {
        return this.serverNetworkingManager.hasAuthenticated;
    }

    public get clientIdentity(): string | undefined {
        return this.serverNetworkingManager.clientIdentity;
    }

    public get isAuthenticated(): boolean {
        return this.isClientAuthenticated && this.isServerAuthenticated;
    }

    public get clientIndexerMode(): number | undefined {
        return this.serverNetworkingManager.clientIndexerMode;
    }

    public get clientNetwork(): number | undefined {
        return this.serverNetworkingManager.clientNetwork;
    }

    public get clientChainId(): ChainIds | undefined {
        return this.serverNetworkingManager.clientChainId;
    }

    public get clientChecksum(): string | undefined {
        return this.serverNetworkingManager.clientChecksum;
    }

    public get clientVersion(): string | undefined {
        return this.serverNetworkingManager.clientVersion;
    }

    private get peerIdentity(): OPNetConnectionInfo {
        if (!this._peerIdentity) {
            throw new Error('Peer identity not found.');
        }

        return this._peerIdentity;
    }

    public requestBlockWitnesses: (blockNumber: bigint) => Promise<ISyncBlockHeaderResponse> =
        () => {
            throw new Error('requestBlockWitnesses not implemented.');
        };

    public onBlockWitness: (blockWitness: IBlockHeaderWitness) => Promise<void> = () => {
        throw new Error('onBlockWitness not implemented.');
    };

    public onBlockWitnessResponse: (packet: ISyncBlockHeaderResponse) => Promise<void> = () => {
        throw new Error('onBlockWitnessResponse not implemented.');
    };

    public getOPNetPeers: () => Promise<OPNetPeerInfo[]> = () => {
        throw new Error('getOPNetPeers not implemented.');
    };

    public reportAuthenticatedPeer: (peerId: PeerId) => void = () => {
        throw new Error('Method not implemented.');
    };

    public onPeersDiscovered: (peers: OPNetPeerInfo[]) => void = () => {
        throw new Error('onPeersDiscovered not implemented.');
    };

    public async authenticate(): Promise<void> {
        return await this.clientNetworkingManager.login();
    }

    public async broadcastMempoolTransaction(transaction: ITransactionPacket): Promise<void> {
        return await this.clientNetworkingManager.broadcastMempoolTransaction(transaction);
    }

    public async requestBlockWitnessesFromPeer(blockNumber: bigint): Promise<void> {
        return this.serverNetworkingManager.requestBlockWitnessesFromPeer(blockNumber);
    }

    public peerMode(): OPNetIndexerMode | undefined {
        const peerType = this.clientIndexerMode;
        if (peerType === undefined) {
            return undefined;
        }

        switch (peerType) {
            case 0:
                return OPNetIndexerMode.ARCHIVE;
            case 1:
                return OPNetIndexerMode.FULL;
            case 2:
                return OPNetIndexerMode.LIGHT;
            default:
                return undefined;
        }
    }

    public async init(): Promise<void> {
        // We wait just a bit to ensure that the connection is established.
        await this.sleep(1500);

        await this.authenticate();
    }

    public sendMsg: (peerId: PeerId, data: Uint8Array | Buffer) => Promise<void> = () => {
        throw new Error('Method not implemented.');
    };

    public generateWitnessToBroadcast(blockWitness: IBlockHeaderWitness): Uint8Array | undefined {
        try {
            return this.serverNetworkingManager.broadcastBlockWitness(blockWitness);
        } catch (e) {
            this.error(`Failed to broadcast block witness. ${e}`);
        }
    }

    public async onMessage(buffer: Uint8Array): Promise<void> {
        try {
            const toClient = buffer.slice(0, 1)[0] === 0x01;

            let success = false;
            switch (toClient) {
                case true:
                    success = await this.clientNetworkingManager.onMessage(buffer.slice(1));
                    break;
                case false:
                    success = await this.serverNetworkingManager.onMessage(buffer.slice(1));
                    break;
            }

            if (!success) {
                throw new Error(`Unknown opcode received. ${buffer[1]}`);
            }
        } catch (e) {
            if (Config.DEV_MODE) {
                console.log(`BAD PACKET`, e);
            }

            if (++this.badPacketCount < 5) {
                await this.disconnect(DisconnectionCode.BAD_PACKET, 'Bad packet.');
                await this.destroy(false);
            }
        }
    }

    public disconnectPeer: (
        peerId: PeerId,
        code: DisconnectionCode,
        reason?: string,
    ) => Promise<void> = () => {
        throw new Error('Method not implemented.');
    };

    public async onDisconnect(): Promise<void> {
        await this.destroy(true);
    }

    public on<T extends string, U extends object>(
        event: T,
        eventHandler: NetworkingEventHandler<U>,
    ): void {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }

        this.eventHandlers.get(event)?.push(eventHandler as NetworkingEventHandler);
    }

    public async destroy(shouldDisconnect: boolean = true): Promise<void> {
        if (this.isDestroyed) return;
        this.selfIdentity = undefined;

        if (shouldDisconnect) {
            try {
                await this.disconnect(DisconnectionCode.RECONNECT, 'Goodbye!');
            } catch (e) {}
        }

        this.isDestroyed = true;
        this.clientNetworkingManager.destroy();

        clearTimeout(this.peerDiscoveryTimeout);

        this.disconnectPeer = () => Promise.resolve();
        this.sendMsg = () => Promise.resolve();
        this.reportAuthenticatedPeer = () => {};
        this.getOPNetPeers = () => Promise.resolve([]);
        this.onBlockWitness = async () => {};

        this.eventHandlers.clear();

        delete this._peerIdentity;
    }

    public sendFromServer(data: Uint8Array | Buffer): Promise<void> {
        return this.serverNetworkingManager.sendPacket(data);
    }

    protected async sendInternal(data: Uint8Array | Buffer): Promise<void> {
        if (this.isDestroyed) return;

        await this.sendMsg(this.peerId, data);
    }

    protected async emit<T extends string, U extends object>(event: T, data: U): Promise<void> {
        const obj = this.eventHandlers.get(event);
        if (!obj) return;

        const promises: (Promise<void> | void)[] = [];
        for (const handler of obj) {
            promises.push(handler(data));
        }

        await Promise.safeAll(promises);
    }

    protected async disconnect(code: DisconnectionCode, reason?: string): Promise<void> {
        if (this.isDestroyed) return;
        this.isClientAuthenticated = false;

        if (Config.DEBUG_LEVEL >= DebugLevel.TRACE) {
            this.debug(`Disconnecting peer ${this.peerId} with code ${code} and reason ${reason}.`);
        }

        await this.disconnectPeer(this.peerId, code, reason);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private defineServerNetworkingEvents(): void {
        this.serverNetworkingManager.disconnectPeer = this.disconnect.bind(this);
        this.serverNetworkingManager.send = async (data: Uint8Array | Buffer) => {
            // to client
            data = Buffer.concat([Buffer.from([0x01]), Buffer.from(data)]);

            return this.sendInternal(data);
        };

        this.serverNetworkingManager.onServerAuthenticationCompleted = () => {
            this.onServerAuthenticationCompleted();
        };

        this.serverNetworkingManager.getOPNetPeers = (): Promise<OPNetPeerInfo[]> => {
            return this.getOPNetPeers();
        };

        this.serverNetworkingManager.onBlockWitnessResponse = async (
            packet: ISyncBlockHeaderResponse,
        ): Promise<void> => {
            return this.onBlockWitnessResponse(packet);
        };

        this.serverNetworkingManager.on(
            CommonHandlers.MEMPOOL_BROADCAST,
            async (packet: TransactionPacket): Promise<void> => {
                await this.emit(CommonHandlers.MEMPOOL_BROADCAST, packet);
            },
        );
    }

    private onPeersDiscoveredInternal(peers: OPNetPeerInfo[]): void {
        this.onPeersDiscovered(peers);
    }

    private defineClientNetworkingEvents(): void {
        this.clientNetworkingManager.disconnectPeer = this.disconnect.bind(this);
        this.clientNetworkingManager.send = async (data: Uint8Array | Buffer) => {
            // to server
            data = Buffer.concat([Buffer.from([0x00]), Buffer.from(data)]);

            return this.sendInternal(data);
        };

        this.clientNetworkingManager.onClientAuthenticationCompleted = () => {
            this.onClientAuthenticationCompleted();
        };

        this.clientNetworkingManager.onPeersDiscovered = (peers: OPNetPeerInfo[]) => {
            this.onPeersDiscoveredInternal(peers);
        };

        this.clientNetworkingManager.onBlockWitness = async (blockWitness: IBlockHeaderWitness) => {
            await this.onBlockWitness(blockWitness);
        };

        this.clientNetworkingManager.requestBlockWitnesses = async (blockNumber: bigint) => {
            return this.requestBlockWitnesses(blockNumber);
        };
    }

    private onAuth(): void {
        if (this.isAuthenticated) {
            this.reportAuthenticatedPeer(this.peerId);

            void this.discoverPeers();
        }
    }

    // TODO: Add checks to this.
    private async discoverPeers(): Promise<void> {
        if (this.isDestroyed) return;

        if (Config.DEBUG_LEVEL >= DebugLevel.TRACE) {
            this.info(`Discovering peers for peer ${this.peerId}.`);
        }

        await this.clientNetworkingManager.discoverPeers();

        if (this.isDestroyed) return;
        this.peerDiscoveryTimeout = setTimeout(async () => {
            await this.discoverPeers();
        }, PEER_DISCOVERY_TIMEOUT);
    }

    private onServerAuthenticationCompleted(): void {
        this.isServerAuthenticated = true;

        this.onAuth();
    }

    private onClientAuthenticationCompleted(): void {
        this.isClientAuthenticated = true;

        this.onAuth();
    }
}
