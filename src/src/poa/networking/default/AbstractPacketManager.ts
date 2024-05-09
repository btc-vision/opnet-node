import { OPNetIdentity } from '../../identity/OPNetIdentity.js';
import { OPNetPacket } from '../protobuf/types/OPNetPacket.js';

export abstract class AbstractPacketManager {
    protected constructor(
        protected readonly peerId: string,
        protected readonly selfIdentity: OPNetIdentity | undefined,
    ) {}

    public abstract destroy(): void;

    public abstract onPacket(packet: OPNetPacket): Promise<boolean>;
}
