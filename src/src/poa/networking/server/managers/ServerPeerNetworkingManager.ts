import { OPNetIdentity } from '../../../identity/OPNetIdentity.js';
import { OPNetPacket } from '../../protobuf/types/OPNetPacket.js';
import { AuthenticationManager } from './AuthenticationManager.js';
import { ServerPeerManager } from './ServerPeerManager.js';

export class ServerPeerNetworkingManager extends AuthenticationManager {
    private destroyed: boolean = false;
    private peerManager: ServerPeerManager | undefined;

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
     * On message handler.
     * @public
     */
    public async onMessage(rawBuf: Uint8Array): Promise<boolean> {
        const raw: Uint8Array = this.decrypt(rawBuf);

        const opcode: number = raw[0];
        const packet: OPNetPacket = {
            opcode: opcode,
            packet: Buffer.from(raw.slice(1)),
        };

        const managed: boolean = await this.onPacket(packet);
        if (!managed) {
            if (this.peerManager) {
                const processed: boolean = await this.peerManager.onPacket(packet);

                if (processed) {
                    return true;
                }
            }
        }

        return managed;
    }

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

    protected onAuthenticated(): void {
        this.createSession();

        this.onServerAuthenticationCompleted();
    }

    private createSession(): void {
        this.peerManager = new ServerPeerManager(this.peerId, this.selfIdentity);
    }
}
