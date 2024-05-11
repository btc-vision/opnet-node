import { OPNetIdentity } from '../../../identity/OPNetIdentity.js';
import { AbstractPacketManager } from '../../default/AbstractPacketManager.js';
import {
    BlockHeaderWitnessPacket,
    IBlockHeaderWitness,
} from '../../protobuf/packets/blockchain/BlockHeaderWitness.js';
import { CommonPackets } from '../../protobuf/types/messages/OPNetMessages.js';
import { OPNetPacket } from '../../protobuf/types/OPNetPacket.js';
import { OPNetProtocolV1 } from '../../server/protocol/OPNetProtocolV1.js';

export class SharedBlockHeaderManager extends AbstractPacketManager {
    constructor(
        protocol: OPNetProtocolV1,
        peerId: string,
        selfIdentity: OPNetIdentity | undefined,
    ) {
        super(protocol, peerId, selfIdentity);
    }

    public getTrustedChecksum: () => string = () => {
        throw new Error('getTrustedChecksum not implemented.');
    };

    public async onPacket(packet: OPNetPacket): Promise<boolean> {
        switch (packet.opcode) {
            case CommonPackets.BLOCK_HEADER_WITNESS:
                await this.onBlockWitness(packet);
                break;

            default:
                return false;
        }

        return true;
    }

    public destroy(): void {
        super.destroy();
    }

    private async onBlockWitness(packet: OPNetPacket): Promise<void> {
        this.info(`Peer ${this.peerId} got a block witness packet.`);

        const blockWitness = (await this.protocol.onIncomingPacket<IBlockHeaderWitness>(
            packet,
        )) as BlockHeaderWitnessPacket;

        if (!blockWitness) {
            return;
        }

        const unpackedPacket = blockWitness.unpack(packet.packet);
        if (!unpackedPacket) {
            return;
        }

        console.log(`[MUST VERIFY] Block witness ->`, unpackedPacket);
    }
}
