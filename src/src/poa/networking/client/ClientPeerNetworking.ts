import { CommonHandlers } from '../../events/CommonHandlers.js';
import { OPNetIdentity } from '../../identity/OPNetIdentity.js';
import { AbstractPacketManager } from '../default/AbstractPacketManager.js';
import { DisconnectionCode } from '../enums/DisconnectionCode.js';
import { IBlockHeaderWitness } from '../protobuf/packets/blockchain/common/BlockHeaderWitness.js';
import { ITransactionPacket } from '../protobuf/packets/blockchain/common/TransactionPacket.js';
import { ISyncBlockHeaderRequest } from '../protobuf/packets/blockchain/requests/SyncBlockHeadersRequest.js';
import {
    ISyncBlockHeaderResponse,
    SyncBlockHeadersResponse,
} from '../protobuf/packets/blockchain/responses/SyncBlockHeadersResponse.js';
import { OPNetPeerInfo } from '../protobuf/packets/peering/DiscoveryResponsePacket.js';
import { Packets } from '../protobuf/types/enums/Packets.js';
import { SharedBlockHeaderManager } from '../shared/managers/SharedBlockHeaderManager.js';
import { SharedMempoolManager } from '../shared/managers/SharedMempoolManager.js';
import { PeerHandlerEvents } from './events/PeerHandlerEvents.js';
import { ClientAuthenticationManager } from './managers/ClientAuthenticationManager.js';
import { ClientPeerManager } from './managers/ClientPeerManager.js';

export class ClientPeerNetworking extends ClientAuthenticationManager {
    public readonly logColor: string = '#00f2fa';

    private _blockHeaderManager: SharedBlockHeaderManager | undefined;
    private _peerManager: ClientPeerManager | undefined;
    private _mempoolManager: SharedMempoolManager | undefined;

    constructor(peerId: string, selfIdentity: OPNetIdentity | undefined) {
        super(selfIdentity, peerId);
    }

    public onBlockWitness: (blockWitness: IBlockHeaderWitness) => Promise<void> = () => {
        throw new Error('onBlockWitness not implemented.');
    };

    public requestBlockWitnesses: (blockNumber: bigint) => Promise<ISyncBlockHeaderResponse> =
        () => {
            throw new Error('requestBlockWitnesses not implemented.');
        };

    public onClientAuthenticationCompleted: () => void = () => {
        throw new Error('onAuthenticationCompleted not implemented.');
    };

    public async login(): Promise<void> {
        if (this.destroyed) return;
        if (!this.selfIdentity) throw new Error('(login) Self identity not found.');

        try {
            await this.attemptAuth(this.selfIdentity.authKey);
        } catch (e) {
            this.error(
                `Failed to authenticate with peer ${this.peerId}. Problem during login. ${e}`,
            );

            await this.disconnectPeer(
                DisconnectionCode.UNABLE_TO_AUTHENTICATE,
                'Failed to authenticate with peer.',
            );
        }
    }

    /**
     * Destroy handler.
     * @protected
     * @description Triggered when the client must be destroyed.
     */
    public destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;

        this.selfIdentity = undefined;

        super.destroy();

        this.onBlockWitness = async () => {};
        this.onClientAuthenticationCompleted = () => {};

        delete this._peerManager;
        delete this._mempoolManager;
        delete this._blockHeaderManager;
    }

    public onPeersDiscovered: (peers: OPNetPeerInfo[]) => Promise<void> = () => {
        throw new Error('onPeersDiscovered not implemented.');
    };

    public async discoverPeers(): Promise<void> {
        if (!this._peerManager) {
            throw new Error('Peer manager not found.');
        }

        await this._peerManager.discoverPeers();
    }

    /**
     * Broadcast a valid transaction to the network.
     * @param transaction
     */
    public async broadcastMempoolTransaction(transaction: ITransactionPacket): Promise<void> {
        if (this.destroyed) {
            throw new Error('Client peer networking is destroyed.');
        }

        if (!this._mempoolManager) {
            throw new Error('Mempool manager not found.');
        }

        await this._mempoolManager.broadcastTransaction(transaction);
    }

    protected createSession(): void {
        this.networkHandlers.push(this.createPeerManager());
        this.networkHandlers.push(this.createBlockWitnessManager());
        this.networkHandlers.push(this.createMempoolManager());

        this.onClientAuthenticationCompleted();
    }

    private createPeerManager(): ClientPeerManager {
        const peerManager: ClientPeerManager = new ClientPeerManager(
            this.protocol,
            this.peerId,
            this.selfIdentity,
        );

        peerManager.getTrustedChecksum = this.trustedChecksum.bind(this);
        peerManager.on(PeerHandlerEvents.PEERS_DISCOVERED, this.onPeersDiscovered.bind(this));

        this.listenToManagerEvents(peerManager);

        this._peerManager = peerManager;

        return peerManager;
    }

    private async onSyncBlockHeadersRequest(packet: ISyncBlockHeaderRequest): Promise<void> {
        if (!this._blockHeaderManager) {
            throw new Error('Block header manager not found.');
        }

        const blockNumber: bigint = BigInt(packet.blockNumber.toString());
        this.log(`Peer ${this.peerId} requested block witnesses for block ${blockNumber}.`);

        const blockWitnesses: ISyncBlockHeaderResponse =
            await this.requestBlockWitnesses(blockNumber);

        /** No witness found, we don't reply. */
        if (blockWitnesses.validatorWitnesses.length === 0) {
            return;
        }

        const packetBuilder = this.protocol.getPacketBuilder(
            Packets.SyncBlockHeadersResponse,
        ) as SyncBlockHeadersResponse;

        if (!packetBuilder) {
            throw new Error('SyncBlockHeadersResponse not found.');
        }

        const packedBlockWitnesses: Uint8Array = packetBuilder.pack(blockWitnesses);
        await this.sendMsg(packedBlockWitnesses);
    }

    private listenToManagerEvents(manager: AbstractPacketManager): void {
        manager.on(CommonHandlers.SEND, this.sendMsg.bind(this));
    }

    private createMempoolManager(): SharedMempoolManager {
        const mempoolManager: SharedMempoolManager = new SharedMempoolManager(
            this.protocol,
            this.peerId,
            this.selfIdentity,
        );

        this.listenToManagerEvents(mempoolManager);
        this._mempoolManager = mempoolManager;

        return mempoolManager;
    }

    private createBlockWitnessManager(): SharedBlockHeaderManager {
        const blockWitnessManager: SharedBlockHeaderManager = new SharedBlockHeaderManager(
            this.protocol,
            this.peerId,
            this.selfIdentity,
        );

        blockWitnessManager.on(
            CommonHandlers.BLOCK_WITNESS,
            async (blockWitness: IBlockHeaderWitness) => {
                console.log('event received. BlockWitness', blockWitness);
                await this.onBlockWitness(blockWitness);
            },
        );

        blockWitnessManager.on(
            CommonHandlers.SYNC_BLOCK_HEADERS_REQUEST,
            this.onSyncBlockHeadersRequest.bind(this),
        );

        this.listenToManagerEvents(blockWitnessManager);
        this._blockHeaderManager = blockWitnessManager;

        return blockWitnessManager;
    }
}
