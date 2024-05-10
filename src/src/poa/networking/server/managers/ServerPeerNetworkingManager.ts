import { OPNetIdentity } from '../../../identity/OPNetIdentity.js';
import { AuthenticationManager } from './AuthenticationManager.js';
import { ServerPeerManager } from './ServerPeerManager.js';

export class ServerPeerNetworkingManager extends AuthenticationManager {
    constructor(
        protected readonly peerId: string,
        private readonly selfIdentity: OPNetIdentity | undefined,
    ) {
        super();

        this.peerId = peerId;
        this.createTimeoutAuth();
    }

    public onServerAuthenticationCompleted: () => void = () => {
        throw new Error('onAuthenticationCompleted not implemented.');
    };

    /**
     * Destroy handler.
     * @protected
     * @description Triggered when the client must be destroyed.
     */
    public destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;

        super.destroy();
    }

    protected createSession(): void {
        const peerManager: ServerPeerManager = new ServerPeerManager(
            this.protocol,
            this.peerId,
            this.selfIdentity,
        );

        this.networkHandlers.push(peerManager);

        this.onServerAuthenticationCompleted();
    }
}
