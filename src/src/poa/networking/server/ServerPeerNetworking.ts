import { CommonHandlers } from '../../events/CommonHandlers.js';
import { OPNetIdentity } from '../../identity/OPNetIdentity.js';
import { AbstractPacketManager } from '../default/AbstractPacketManager.js';
import { IBlockHeaderWitness } from '../protobuf/packets/blockchain/BlockHeaderWitness.js';
import { OPNetPeerInfo } from '../protobuf/packets/peering/DiscoveryResponsePacket.js';
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

    /*protected get peerManager(): ServerPeerManager {
        if (!this._peerManager) {
            throw new Error('Peer manager not found.');
        }

        return this._peerManager;
    }*/

    public onServerAuthenticationCompleted: () => void = () => {
        throw new Error('onAuthenticationCompleted not implemented.');
    };

    public getOPNetPeers: () => OPNetPeerInfo[] = () => {
        throw new Error('getOPNetPeers not implemented.');
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

    private listenToManagerEvents(manager: AbstractPacketManager): void {
        manager.on(CommonHandlers.SEND, this.sendMsg.bind(this));
    }

    private createBlockWitnessManager(): ServerBlockHeaderWitnessManager {
        const blockWitnessManager: ServerBlockHeaderWitnessManager =
            new ServerBlockHeaderWitnessManager(this.protocol, this.peerId, this.selfIdentity);

        this.listenToManagerEvents(blockWitnessManager);

        this._blockHeaderManager = blockWitnessManager;

        return blockWitnessManager;
    }
}
