import { OPNetIdentity } from '../../../identity/OPNetIdentity.js';
import { AbstractPacketManager } from '../../default/AbstractPacketManager.js';
import { CommonPackets } from '../../protobuf/types/messages/OPNetMessages.js';
import { OPNetPacket } from '../../protobuf/types/OPNetPacket.js';
import { OPNetProtocolV1 } from '../../server/protocol/OPNetProtocolV1.js';

export class SharedTransactionManager extends AbstractPacketManager {
    constructor(
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

    private async onTransactionBroadcast(packet: OPNetPacket): Promise<void> {
        console.log('Transaction broadcasted', packet);
    }

    /*public async discoverPeers(): Promise<void> {
        const packet = this.protocol.getPacketBuilder(Packets.Discover);
        if (!packet) {
            return;
        }

        const discoverData: IDiscover = {
            version: AuthenticationManager.CURRENT_PROTOCOL_VERSION,
            trustedChecksum: this.getTrustedChecksum(),
        };

        await this.sendMsg(packet.pack(discoverData));
    }

    private async onDiscoveryResponse(packet: OPNetPacket): Promise<void> {
        this.info(`Peer ${this.peerId} got discovery a response.`);

        const discoveryPacket = (await this.protocol.onIncomingPacket<IDiscoveryResponse>(
            packet,
        )) as DiscoveryResponsePacket;

        if (!discoveryPacket) {
            return;
        }

        const unpackedPacket = discoveryPacket.unpack(packet.packet);
        if (!unpackedPacket) {
            return;
        }

        await this.emit(PeerHandlerEvents.PEERS_DISCOVERED, unpackedPacket.peers);
    }*/
}
