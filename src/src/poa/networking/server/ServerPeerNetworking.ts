import Long from 'long';
import { CommonHandlers } from '../../events/CommonHandlers.js';
import { OPNetIdentity } from '../../identity/OPNetIdentity.js';
import { AbstractPacketManager } from '../default/AbstractPacketManager.js';
import { IBlockHeaderWitness } from '../protobuf/packets/blockchain/common/BlockHeaderWitness.js';
import {
    ISyncBlockHeaderRequest,
    SyncBlockHeadersRequest,
} from '../protobuf/packets/blockchain/requests/SyncBlockHeadersRequest.js';
import { ISyncBlockHeaderResponse } from '../protobuf/packets/blockchain/responses/SyncBlockHeadersResponse.js';
import { OPNetPeerInfo } from '../protobuf/packets/peering/DiscoveryResponsePacket.js';
import { Packets } from '../protobuf/types/enums/Packets.js';
import { SharedMempoolManager } from '../shared/managers/SharedMempoolManager.js';
import { AuthenticationManager } from './managers/AuthenticationManager.js';
import { ServerBlockHeaderWitnessManager } from './managers/ServerBlockHeaderWitnessManager.js';
import { ServerPeerManager } from './managers/ServerPeerManager.js';
import { TransactionPacket } from '../protobuf/packets/blockchain/common/TransactionPacket.js';

export class ServerPeerNetworking extends AuthenticationManager {
    private _blockHeaderManager: ServerBlockHeaderWitnessManager | undefined;
    private _peerManager: ServerPeerManager | undefined;
    private _mempoolManager: SharedMempoolManager | undefined;

    constructor(
        protected readonly peerId: string,
        selfIdentity: OPNetIdentity | undefined,
    ) {
        super(selfIdentity);

        this.peerId = peerId;
        this.createTimeoutAuth();
    }

    public onServerAuthenticationCompleted: () => void = () => {
        throw new Error('onAuthenticationCompleted not implemented.');
    };

    public getOPNetPeers: () => Promise<OPNetPeerInfo[]> = () => {
        throw new Error('getOPNetPeers not implemented.');
    };

    public onBlockWitnessResponse: (packet: ISyncBlockHeaderResponse) => Promise<void> = () => {
        throw new Error('onBlockWitnessResponse not implemented.');
    };

    public broadcastBlockWitness(blockWitness: IBlockHeaderWitness): Uint8Array {
        if (this.destroyed) {
            throw new Error('Server peer networking is destroyed.');
        }

        if (!this._blockHeaderManager) {
            throw new Error('Block witness manager not found.');
        }

        return this._blockHeaderManager.packMessageBlockHeaderWitness(blockWitness);
    }

    /**
     * Destroy handler.
     * @protected
     * @description Triggered when the client must be destroyed.
     */
    public destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;

        delete this._peerManager;
        delete this._blockHeaderManager;
        delete this._mempoolManager;

        this.onServerAuthenticationCompleted = () => {};
        this.getOPNetPeers = () => {
            throw new Error('getOPNetPeers not implemented.');
        };

        super.destroy();
    }

    public async sendPacket(packet: Uint8Array): Promise<void> {
        await this.sendMsg(packet);
    }

    public async requestBlockWitnessesFromPeer(blockNumber: bigint): Promise<void> {
        const requestBlockWitnesses: ISyncBlockHeaderRequest = {
            blockNumber: Long.fromString(blockNumber.toString()),
        };

        const syncBlockHeaderRequest: SyncBlockHeadersRequest | undefined =
            this.protocol.getPacketBuilder(Packets.SyncBlockHeadersRequest) as
                | SyncBlockHeadersRequest
                | undefined;

        if (!syncBlockHeaderRequest) {
            throw new Error('SyncBlockHeadersRequest not found.');
        }

        await this.sendMsg(syncBlockHeaderRequest.pack(requestBlockWitnesses));
    }

    protected createSession(): void {
        this.networkHandlers.push(this.createPeerManager());
        this.networkHandlers.push(this.createBlockWitnessManager());
        this.networkHandlers.push(this.createMempoolManager());

        this.onServerAuthenticationCompleted();
    }

    private createMempoolManager(): SharedMempoolManager {
        const mempoolManager: SharedMempoolManager = new SharedMempoolManager(
            this.protocol,
            this.peerId,
            this.selfIdentity,
        );

        this.listenToManagerEvents(mempoolManager);
        this._mempoolManager = mempoolManager;

        this._mempoolManager.on(
            CommonHandlers.MEMPOOL_BROADCAST,
            async (packet: TransactionPacket): Promise<void> => {
                await this.emit(CommonHandlers.MEMPOOL_BROADCAST, packet);
            },
        );

        return mempoolManager;
    }

    private createPeerManager(): ServerPeerManager {
        const peerManager: ServerPeerManager = new ServerPeerManager(
            this.protocol,
            this.peerId,
            this.selfIdentity,
        );

        peerManager.getOPNetPeers = () => {
            return this.getOPNetPeers();
        };

        this.listenToManagerEvents(peerManager);

        return peerManager;
    }

    private async handleSyncBlockHeadersResponse(packet: ISyncBlockHeaderResponse): Promise<void> {
        if (!this._blockHeaderManager) {
            throw new Error('Block witness manager not found.');
        }

        await this.onBlockWitnessResponse(packet);
    }

    private listenToManagerEvents(manager: AbstractPacketManager): void {
        manager.on(CommonHandlers.SEND, this.sendMsg.bind(this));
        manager.on(
            CommonHandlers.SYNC_BLOCK_HEADERS_RESPONSE,
            this.handleSyncBlockHeadersResponse.bind(this),
        );
    }

    private createBlockWitnessManager(): ServerBlockHeaderWitnessManager {
        const blockWitnessManager: ServerBlockHeaderWitnessManager =
            new ServerBlockHeaderWitnessManager(this.protocol, this.peerId, this.selfIdentity);

        this.listenToManagerEvents(blockWitnessManager);

        this._blockHeaderManager = blockWitnessManager;

        return blockWitnessManager;
    }
}
