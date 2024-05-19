import { Type } from 'protobufjs';
import { Packets } from '../../../types/enums/Packets.js';
import { CommonPackets } from '../../../types/messages/OPNetMessages.js';
import { PackedMessage, Packet } from '../../Packet.js';

export interface ITransactionPacket extends PackedMessage {
    readonly transaction: Uint8Array;
}

/** Broadcast goes both ways */
export class TransactionPacket extends Packet<
    ITransactionPacket,
    ITransactionPacket,
    ITransactionPacket
> {
    public static TYPE: Packets = Packets.BroadcastTransaction;

    protected readonly opcode: CommonPackets = CommonPackets.TRANSACTION;

    constructor(protobufType: Type) {
        super(protobufType);
    }
}
