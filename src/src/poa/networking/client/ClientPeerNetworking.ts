import { CommonHandlers } from '../../events/CommonHandlers.js';
import { OPNetIdentity } from '../../identity/OPNetIdentity.js';
import { AbstractPacketManager } from '../default/AbstractPacketManager.js';
import { DisconnectionCode } from '../enums/DisconnectionCode.js';
import { SharedBlockHeaderManager } from '../shared/managers/SharedBlockHeaderManager.js';
import { PeerHandlerEvents } from './events/PeerHandlerEvents.js';
import { ClientAuthenticationManager } from './managers/ClientAuthenticationManager.js';
import { ClientPeerManager } from './managers/ClientPeerManager.js';

export class ClientPeerNetworking extends ClientAuthenticationManager {
    public readonly logColor: string = '#00f2fa';
    private _blockHeaderManager: SharedBlockHeaderManager | undefined;

    constructor(peerId: string, selfIdentity: OPNetIdentity | undefined) {
        super(selfIdentity, peerId);
    }

    private _peerManager: ClientPeerManager | undefined;

    protected get peerManager(): ClientPeerManager {
        if (!this._peerManager) {
            throw new Error('Peer manager not found.');
        }

        return this._peerManager;
    }

    public onClientAuthenticationCompleted: () => void = () => {
        throw new Error('onAuthenticationCompleted not implemented.');
    };

    public async login(): Promise<void> {
        if (!this.selfIdentity) throw new Error('Self identity not found.');

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

        delete this._peerManager;
        delete this._blockHeaderManager;
    }

    public onPeersDiscovered: () => Promise<void> = () => {
        throw new Error('onPeersDiscovered not implemented.');
    };

    public async requestPeers(): Promise<void> {
        return await this.peerManager.discoverPeers();
    }

    protected createSession(): void {
        this.networkHandlers.push(this.createPeerManager());
        this.networkHandlers.push(this.createBlockWitnessManager());

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

    private listenToManagerEvents(manager: AbstractPacketManager): void {
        manager.on(CommonHandlers.SEND, this.sendMsg.bind(this));
    }

    private createBlockWitnessManager(): SharedBlockHeaderManager {
        const blockWitnessManager: SharedBlockHeaderManager = new SharedBlockHeaderManager(
            this.protocol,
            this.peerId,
            this.selfIdentity,
        );

        blockWitnessManager.getTrustedChecksum = this.trustedChecksum.bind(this);
        this.listenToManagerEvents(blockWitnessManager);

        this._blockHeaderManager = blockWitnessManager;

        return blockWitnessManager;
    }
}
