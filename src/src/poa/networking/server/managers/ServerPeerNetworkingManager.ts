import { OPNetIdentity } from '../../../identity/OPNetIdentity.js';
import { OPNetPeerInfo } from '../../protobuf/packets/peering/DiscoveryResponsePacket.js';
import { AuthenticationManager } from './AuthenticationManager.js';
import { ServerPeerManager } from './ServerPeerManager.js';

export class ServerPeerNetworkingManager extends AuthenticationManager {
    constructor(
        protected readonly peerId: string,
        selfIdentity: OPNetIdentity | undefined,
    ) {
        super(selfIdentity);

        this.peerId = peerId;
        this.createTimeoutAuth();
    }

    private _peerManager: ServerPeerManager | undefined;

    protected get peerManager(): ServerPeerManager {
        if (!this._peerManager) {
            throw new Error('Peer manager not found.');
        }

        return this._peerManager;
    }

    public onServerAuthenticationCompleted: () => void = () => {
        throw new Error('onAuthenticationCompleted not implemented.');
    };

    public getOPNetPeers: () => OPNetPeerInfo[] = () => {
        throw new Error('getOPNetPeers not implemented.');
    };

    /**
     * Destroy handler.
     * @protected
     * @description Triggered when the client must be destroyed.
     */
    public destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;

        delete this._peerManager;

        super.destroy();
    }

    protected createSession(): void {
        const peerManager = this.createPeerManager();

        this.networkHandlers.push(peerManager);

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

        return peerManager;
    }
}
