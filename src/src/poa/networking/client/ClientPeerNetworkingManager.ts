import { OPNetIdentity } from '../../identity/OPNetIdentity.js';
import { OPNetPacket } from '../protobuf/types/OPNetPacket.js';
import { ClientAuthenticationManager } from './managers/ClientAuthenticationManager.js';

export class ClientPeerNetworkingManager extends ClientAuthenticationManager {
    public readonly logColor: string = '#00f2fa';
    protected readonly peerId: string;
    private destroyed: boolean = false;

    constructor(peerId: string, selfIdentity: OPNetIdentity | undefined) {
        super(selfIdentity);

        this.peerId = peerId;
    }

    public async login(): Promise<void> {
        if (!this.selfIdentity) throw new Error('Self identity not found.');

        await this.attemptAuth(this.selfIdentity.authKey);
    }

    /**
     * On message handler.
     * @private
     */
    public async onMessage(rawBuf: Uint8Array): Promise<boolean> {
        const raw: Uint8Array = this.decrypt(rawBuf);

        const opcode: number = raw[0];
        const packet: OPNetPacket = {
            opcode: opcode,
            packet: Buffer.from(raw.slice(1)),
        };

        return await this.onPacket(packet);
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
    }
}
