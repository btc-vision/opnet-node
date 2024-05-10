import { CommonHandlers } from '../../events/CommonHandlers.js';
import { OPNetIdentity } from '../../identity/OPNetIdentity.js';
import { DisconnectionCode } from '../enums/DisconnectionCode.js';
import { PeerHandlerEvents } from './events/PeerHandlerEvents.js';
import { ClientAuthenticationManager } from './managers/ClientAuthenticationManager.js';
import { ClientPeerManager } from './managers/ClientPeerManager.js';

export class ClientPeerNetworkingManager extends ClientAuthenticationManager {
    public readonly logColor: string = '#00f2fa';

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
    }

    public onPeersDiscovered: () => Promise<void> = () => {
        throw new Error('onPeersDiscovered not implemented.');
    };

    public async requestPeers(): Promise<void> {
        return await this.peerManager.discoverPeers();
    }

    protected createSession(): void {
        this.networkHandlers.push(this.createPeerManager());

        this.onClientAuthenticationCompleted();
    }

    private createPeerManager(): ClientPeerManager {
        const peerManager = new ClientPeerManager(this.protocol, this.peerId, this.selfIdentity);
        peerManager.getTrustedChecksum = this.trustedChecksum.bind(this);

        peerManager.on(CommonHandlers.SEND, this.sendMsg.bind(this));
        peerManager.on(PeerHandlerEvents.PEERS_DISCOVERED, this.onPeersDiscovered.bind(this));

        this._peerManager = peerManager;

        return peerManager;
    }
}
