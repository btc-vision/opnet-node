import { Type } from 'protobufjs';
import { Packets } from '../../types/enums/Packets.js';
import { ServerInBound } from '../../types/messages/OPNetMessages.js';
import { PackedMessage, Packet } from '../Packet.js';

export interface IDiscover extends PackedMessage {
    readonly version: string;
    readonly trustedChecksum: string;
}

export class DiscoverPacket extends Packet<IDiscover, IDiscover, IDiscover> {
    public static TYPE: Packets = Packets.Discover;

    protected readonly opcode: ServerInBound = ServerInBound.DISCOVER;

    constructor(protobufType: Type) {
        super(protobufType);
    }
}
