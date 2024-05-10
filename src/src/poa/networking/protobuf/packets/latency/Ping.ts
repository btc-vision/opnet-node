import Long from 'long';
import { Type } from 'protobufjs';
import { Packets } from '../../types/enums/Packets.js';
import { ServerInBound } from '../../types/messages/OPNetMessages.js';
import { PackedMessage, Packet } from '../Packet.js';

export interface IPingPacket extends PackedMessage {
    readonly timestamp: Long;
    readonly lastPing: Long;
}

export class Ping extends Packet<IPingPacket, IPingPacket, IPingPacket> {
    public static TYPE: Packets = Packets.Ping;

    protected readonly opcode: ServerInBound = ServerInBound.PING;

    constructor(protobufType: Type) {
        super(protobufType);
    }
}
