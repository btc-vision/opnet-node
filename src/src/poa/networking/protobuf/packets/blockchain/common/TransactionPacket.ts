import { Type } from 'protobufjs';
import { Packets } from '../../../types/enums/Packets.js';
import { CommonPackets } from '../../../types/messages/OPNetMessages.js';
import { PackedMessage, Packet } from '../../Packet.js';

export interface ITransactionPacket extends PackedMessage {
    readonly transaction: Uint8Array;
    readonly psbt: boolean;
}

/** Broadcast goes both ways */
export class TransactionPacket extends Packet<
    ITransactionPacket,
    ITransactionPacket,
    ITransactionPacket
> {
    public static TYPE: Packets = Packets.BroadcastTransaction;

    protected readonly opcode: CommonPackets = CommonPackets.BROADCAST_TRANSACTION;

    constructor(protobufType: Type) {
        super(protobufType);
    }
}
