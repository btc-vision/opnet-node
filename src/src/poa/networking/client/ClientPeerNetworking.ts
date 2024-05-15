import { CommonHandlers } from '../../events/CommonHandlers.js';
import { OPNetIdentity } from '../../identity/OPNetIdentity.js';
import { AbstractPacketManager } from '../default/AbstractPacketManager.js';
import { DisconnectionCode } from '../enums/DisconnectionCode.js';
import { IBlockHeaderWitness } from '../protobuf/packets/blockchain/BlockHeaderWitness.js';
import { SharedBlockHeaderManager } from '../shared/managers/SharedBlockHeaderManager.js';
import { PeerHandlerEvents } from './events/PeerHandlerEvents.js';
import { ClientAuthenticationManager } from './managers/ClientAuthenticationManager.js';
import { ClientPeerManager } from './managers/ClientPeerManager.js';

export class ClientPeerNetworking extends ClientAuthenticationManager {
    public readonly logColor: string = '#00f2fa';
    private _blockHeaderManager: SharedBlockHeaderManager | undefined;
    private _peerManager: ClientPeerManager | undefined;

    constructor(peerId: string, selfIdentity: OPNetIdentity | undefined) {
        super(selfIdentity, peerId);
    }

    public onBlockWitness: (blockWitness: IBlockHeaderWitness) => Promise<void> = () => {
        throw new Error('onBlockWitness not implemented.');
    };

    public onClientAuthenticationCompleted: () => void = () => {
        throw new Error('onAuthenticationCompleted not implemented.');
    };

    public async login(): Promise<void> {
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
        delete this._blockHeaderManager;
    }

    public onPeersDiscovered: () => Promise<void> = () => {
        throw new Error('onPeersDiscovered not implemented.');
    };

    protected createSession(): void {
        this.networkHandlers.push(this.createPeerManager());
        this.networkHandlers.push(this.createBlockWitnessManager());

        this.onClientAuthenticationCompleted();

        void this.discoverPeers();
    }

    private async discoverPeers(): Promise<void> {
        if (!this._peerManager) {
            throw new Error('Peer manager not found.');
        }

        await this._peerManager.discoverPeers();
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

    private listenToManagerEvents(manager: AbstractPacketManager): void {
        manager.on(CommonHandlers.SEND, this.sendMsg.bind(this));
    }

    private createBlockWitnessManager(): SharedBlockHeaderManager {
        const blockWitnessManager: SharedBlockHeaderManager = new SharedBlockHeaderManager(
            this.protocol,
            this.peerId,
            this.selfIdentity,
        );

        blockWitnessManager.on(CommonHandlers.BLOCK_WITNESS, this.onBlockWitness.bind(this));

        this.listenToManagerEvents(blockWitnessManager);
        this._blockHeaderManager = blockWitnessManager;

        return blockWitnessManager;
    }
}
