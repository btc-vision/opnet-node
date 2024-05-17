import { OPNetIdentity } from '../../../identity/OPNetIdentity.js';
import { IBlockHeaderWitness } from '../../protobuf/packets/blockchain/common/BlockHeaderWitness.js';
import { Packets } from '../../protobuf/types/enums/Packets.js';
import { SharedBlockHeaderManager } from '../../shared/managers/SharedBlockHeaderManager.js';
import { OPNetProtocolV1 } from '../protocol/OPNetProtocolV1.js';

export class ServerBlockHeaderWitnessManager extends SharedBlockHeaderManager {
    constructor(
        protocol: OPNetProtocolV1,
        peerId: string,
        selfIdentity: OPNetIdentity | undefined,
    ) {
        super(protocol, peerId, selfIdentity);
    }

    public async onBlockHeaderWitness(blockHeader: IBlockHeaderWitness): Promise<void> {
        const packet = this.protocol.getPacketBuilder(Packets.BlockHeaderWitness);
        if (!packet) {
            return;
        }

        await this.sendMsg(packet.pack(blockHeader));
    }
}
