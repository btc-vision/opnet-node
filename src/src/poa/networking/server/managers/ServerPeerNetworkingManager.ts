import { OPNetPacket } from '../../protobuf/types/OPNetPacket.js';
import { AuthenticationManager } from './AuthenticationManager.js';

export class ServerPeerNetworkingManager extends AuthenticationManager {
    protected readonly peerId: string;
    private destroyed: boolean = false;

    constructor(peerId: string) {
        super();

        this.peerId = peerId;
        this.createTimeoutAuth();
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

        super.destroy();
    }
}
