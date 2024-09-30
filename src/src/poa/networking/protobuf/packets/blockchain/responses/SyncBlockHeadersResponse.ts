import Long from 'long';
import { Type } from 'protobufjs';
import { Packets } from '../../../types/enums/Packets.js';
import { ServerOutBound } from '../../../types/messages/OPNetMessages.js';
import { PackedMessage, Packet } from '../../Packet.js';
import { OPNetBlockWitness } from '../common/BlockHeaderWitness.js';

export interface ISyncBlockHeaderResponse extends PackedMessage {
    readonly blockNumber: Long;

    readonly validatorWitnesses: OPNetBlockWitness[];
    readonly trustedWitnesses: OPNetBlockWitness[];
}

/** Broadcast goes both ways */
export class SyncBlockHeadersResponse extends Packet<
    ISyncBlockHeaderResponse,
    ISyncBlockHeaderResponse,
    ISyncBlockHeaderResponse
> {
    public static TYPE: Packets = Packets.SyncBlockHeadersResponse;

    protected readonly opcode: ServerOutBound = ServerOutBound.SYNC_BLOCK_HEADERS_RESPONSE;

    public constructor(protobufType: Type) {
        super(protobufType);
    }
}
