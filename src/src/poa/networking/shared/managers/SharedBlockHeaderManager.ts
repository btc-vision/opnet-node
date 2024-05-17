import { CommonHandlers } from '../../../events/CommonHandlers.js';
import { OPNetIdentity } from '../../../identity/OPNetIdentity.js';
import { AbstractPacketManager } from '../../default/AbstractPacketManager.js';
import {
    BlockHeaderWitnessPacket,
    IBlockHeaderWitness,
} from '../../protobuf/packets/blockchain/common/BlockHeaderWitness.js';
import {
    ISyncBlockHeaderRequest,
    SyncBlockHeadersRequest,
} from '../../protobuf/packets/blockchain/requests/SyncBlockHeadersRequest.js';
import {
    ISyncBlockHeaderResponse,
    SyncBlockHeadersResponse,
} from '../../protobuf/packets/blockchain/responses/SyncBlockHeadersResponse.js';
import {
    CommonPackets,
    ServerInBound,
    ServerOutBound,
} from '../../protobuf/types/messages/OPNetMessages.js';
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

    public async onPacket(packet: OPNetPacket): Promise<boolean> {
        console.log(packet);
        switch (packet.opcode) {
            case CommonPackets.BLOCK_HEADER_WITNESS: {
                await this.onBlockWitness(packet);
                break;
            }
            case ServerOutBound.SYNC_BLOCK_HEADERS_RESPONSE: {
                await this.onSyncBlockHeadersResponse(packet);
                break;
            }
            case ServerInBound.SYNC_BLOCK_HEADERS_REQUEST: {
                await this.onSyncBlockHeadersRequest(packet);
                break;
            }
            default: {
                return false;
            }
        }

        return true;
    }

    public destroy(): void {
        super.destroy();
    }

    private async onSyncBlockHeadersRequest(packet: OPNetPacket): Promise<void> {
        const syncBlockHeadersRequest =
            (await this.protocol.onIncomingPacket<ISyncBlockHeaderRequest>(
                packet,
            )) as SyncBlockHeadersRequest;

        if (!syncBlockHeadersRequest) {
            return;
        }

        const unpackedPacket = syncBlockHeadersRequest.unpack(packet.packet);
        if (!unpackedPacket) {
            return;
        }

        await this.emit(CommonHandlers.SYNC_BLOCK_HEADERS_REQUEST, unpackedPacket);
    }

    private async onSyncBlockHeadersResponse(packet: OPNetPacket): Promise<void> {
        const syncBlockHeadersResponse =
            (await this.protocol.onIncomingPacket<ISyncBlockHeaderResponse>(
                packet,
            )) as SyncBlockHeadersResponse;

        if (!syncBlockHeadersResponse) {
            return;
        }

        const unpackedPacket = syncBlockHeadersResponse.unpack(packet.packet);
        if (!unpackedPacket) {
            return;
        }

        await this.emit(CommonHandlers.SYNC_BLOCK_HEADERS_RESPONSE, unpackedPacket);
    }

    private async onBlockWitness(packet: OPNetPacket): Promise<void> {
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

        await this.emit(CommonHandlers.BLOCK_WITNESS, unpackedPacket);
    }
}
