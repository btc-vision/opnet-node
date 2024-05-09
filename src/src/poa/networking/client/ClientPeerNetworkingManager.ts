import { OPNetIdentity } from '../../identity/OPNetIdentity.js';
import { OPNetPacket } from '../protobuf/types/OPNetPacket.js';
import { ClientAuthenticationManager } from './managers/ClientAuthenticationManager.js';
import { ClientPeerManager } from './managers/ClientPeerManager.js';

export class ClientPeerNetworkingManager extends ClientAuthenticationManager {
    public readonly logColor: string = '#00f2fa';

    private destroyed: boolean = false;
    private peerManager: ClientPeerManager | undefined;

    constructor(peerId: string, selfIdentity: OPNetIdentity | undefined) {
        super(selfIdentity, peerId);
    }

    public onClientAuthenticationCompleted: () => void = () => {
        throw new Error('onAuthenticationCompleted not implemented.');
    };

    public async login(): Promise<void> {
        if (!this.selfIdentity) throw new Error('Self identity not found.');

        await this.attemptAuth(this.selfIdentity.authKey);
    }

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
        this.selfIdentity = undefined;

        super.destroy();

        if (this.peerManager) {
            this.peerManager.destroy();

            delete this.peerManager;
        }
    }

    protected onAuthenticated(): void {
        this.createSession();

        this.onClientAuthenticationCompleted();
    }

    private createSession(): void {
        this.peerManager = new ClientPeerManager(this.peerId, this.selfIdentity);
    }
}
