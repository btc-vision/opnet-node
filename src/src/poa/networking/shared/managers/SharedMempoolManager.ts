import { CommonHandlers } from '../../../events/CommonHandlers.js';
import { OPNetIdentity } from '../../../identity/OPNetIdentity.js';
import { AbstractPacketManager } from '../../default/AbstractPacketManager.js';
import {
    ITransactionPacket,
    TransactionPacket,
} from '../../protobuf/packets/blockchain/common/TransactionPacket.js';
import { Packets } from '../../protobuf/types/enums/Packets.js';
import { CommonPackets } from '../../protobuf/types/messages/OPNetMessages.js';
import { OPNetPacket } from '../../protobuf/types/OPNetPacket.js';
import { OPNetProtocolV1 } from '../../server/protocol/OPNetProtocolV1.js';

export class SharedMempoolManager extends AbstractPacketManager {
    public constructor(
        protocol: OPNetProtocolV1,
        peerId: string,
        selfIdentity: OPNetIdentity | undefined,
    ) {
        super(protocol, peerId, selfIdentity);
    }

    public async onPacket(packet: OPNetPacket): Promise<boolean> {
        switch (packet.opcode) {
            case CommonPackets.BROADCAST_TRANSACTION:
                await this.onTransactionBroadcast(packet);
                break;

            default:
                return false;
        }

        return true;
    }

    public destroy(): void {
        super.destroy();
    }

    public async broadcastTransaction(transaction: ITransactionPacket): Promise<void> {
        const packet = this.protocol.getPacketBuilder(Packets.BroadcastTransaction);
        if (!packet) {
            return;
        }

        await this.sendMsg(packet.pack(transaction));
    }

    private async onTransactionBroadcast(packet: OPNetPacket): Promise<void> {
        const transactionPacket = this.protocol.onIncomingPacket<ITransactionPacket>(
            packet,
        ) as TransactionPacket;

        if (!transactionPacket) {
            return;
        }

        const unpackedPacket = transactionPacket.unpack(packet.packet);
        if (!unpackedPacket) {
            return;
        }

        await this.emit(CommonHandlers.MEMPOOL_BROADCAST, unpackedPacket);
    }
}
