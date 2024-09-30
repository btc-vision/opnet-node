import Long from 'long';
import { Type } from 'protobufjs';
import { Packets } from '../../types/enums/Packets.js';
import { CommonPackets } from '../../types/messages/OPNetMessages.js';
import { PackedMessage, Packet } from '../Packet.js';

export interface IPongPacket extends PackedMessage {
    readonly timestamp: Long;
    readonly lastPing: Long;
}

export class Pong extends Packet<IPongPacket, IPongPacket, IPongPacket> {
    public static TYPE: Packets = Packets.Ping;

    protected readonly opcode: CommonPackets = CommonPackets.PONG;

    public constructor(protobufType: Type) {
        super(protobufType);
    }
}
