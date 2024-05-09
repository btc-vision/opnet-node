import { OPNetIdentity } from '../../../identity/OPNetIdentity.js';
import { AbstractPacketManager } from '../../default/AbstractPacketManager.js';
import { OPNetPacket } from '../../protobuf/types/OPNetPacket.js';

export class ClientPeerManager extends AbstractPacketManager {
    constructor(peerId: string, selfIdentity: OPNetIdentity | undefined) {
        super(peerId, selfIdentity);
    }

    public async onPacket(packet: OPNetPacket): Promise<boolean> {
        return true;
    }

    public destroy(): void {}
}
