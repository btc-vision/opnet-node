import Long from 'long';
import { Type } from 'protobufjs';
import { Packets } from '../../../types/enums/Packets.js';
import { ServerInBound } from '../../../types/messages/OPNetMessages.js';
import { PackedMessage, Packet } from '../../Packet.js';

export interface ISyncBlockHeaderRequest extends PackedMessage {
    readonly blockNumber: Long;
}

/** Broadcast goes both ways */
export class SyncBlockHeadersRequest extends Packet<
    ISyncBlockHeaderRequest,
    ISyncBlockHeaderRequest,
    ISyncBlockHeaderRequest
> {
    public static TYPE: Packets = Packets.SyncBlockHeadersRequest;

    protected readonly opcode: ServerInBound = ServerInBound.SYNC_BLOCK_HEADERS_REQUEST;

    public constructor(protobufType: Type) {
        super(protobufType);
    }
}
