import { Type } from 'protobufjs';
import { Packets } from '../../../types/enums/Packets.js';
import { ServerOutBound } from '../../../types/messages/OPNetMessages.js';
import { PackedMessage, Packet } from '../../Packet.js';
import { IBlockHeaderWitness } from '../common/BlockHeaderWitness.js';

export interface ISyncBlockHeaderResponse extends PackedMessage {
    readonly blockHeaders: IBlockHeaderWitness[];
}

/** Broadcast goes both ways */
export class SyncBlockHeadersResponse extends Packet<
    ISyncBlockHeaderResponse,
    ISyncBlockHeaderResponse,
    ISyncBlockHeaderResponse
> {
    public static TYPE: Packets = Packets.SyncBlockHeadersResponse;

    protected readonly opcode: ServerOutBound = ServerOutBound.SYNC_BLOCK_HEADERS_RESPONSE;

    constructor(protobufType: Type) {
        super(protobufType);
    }
}
