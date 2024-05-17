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
import { AuthenticationManager } from './managers/AuthenticationManager.js';
import { ServerBlockHeaderWitnessManager } from './managers/ServerBlockHeaderWitnessManager.js';
import { ServerPeerManager } from './managers/ServerPeerManager.js';

export class ServerPeerNetworking extends AuthenticationManager {
    private _blockHeaderManager: ServerBlockHeaderWitnessManager | undefined;
    private _peerManager: ServerPeerManager | undefined;

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

    public async broadcastBlockWitness(blockWitness: IBlockHeaderWitness): Promise<void> {
        if (this.destroyed) {
            throw new Error('Server peer networking is destroyed.');
        }

        if (!this._blockHeaderManager) {
            throw new Error('Block witness manager not found.');
        }

        await this._blockHeaderManager.onBlockHeaderWitness(blockWitness);
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

        this.onServerAuthenticationCompleted = () => {};
        this.getOPNetPeers = () => {
            throw new Error('getOPNetPeers not implemented.');
        };

        super.destroy();
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

        this.onServerAuthenticationCompleted();
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

        console.log(packet);

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
