import { OPNetIdentity } from '../../../identity/OPNetIdentity.js';
import {
    BlockHeaderWitnessPacket,
    IBlockHeaderWitness,
} from '../../protobuf/packets/blockchain/common/BlockHeaderWitness.js';

import { Packets } from '../../protobuf/types/enums/Packets.js';
import { SharedBlockHeaderManager } from '../../shared/managers/SharedBlockHeaderManager.js';
import { OPNetProtocolV1 } from '../protocol/OPNetProtocolV1.js';

import Long from 'long';

export class ServerBlockHeaderWitnessManager extends SharedBlockHeaderManager {
    public constructor(
        protocol: OPNetProtocolV1,
        peerId: string,
        selfIdentity: OPNetIdentity | undefined,
    ) {
        super(protocol, peerId, selfIdentity);
    }

    public packMessageBlockHeaderWitness(blockHeader: IBlockHeaderWitness): Uint8Array {
        const packet: BlockHeaderWitnessPacket = this.protocol.getPacketBuilder(
            Packets.BlockHeaderWitness,
        ) as BlockHeaderWitnessPacket;

        if (!packet) {
            throw new Error('Failed to get packet builder.');
        }

        const newBlockHeader: IBlockHeaderWitness = {
            ...blockHeader,
            blockNumber: Long.fromString(blockHeader.blockNumber.toString()),
        };

        return packet.pack(newBlockHeader);
    }
}
