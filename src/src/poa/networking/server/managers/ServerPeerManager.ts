import { OPNetIdentity } from '../../../identity/OPNetIdentity.js';
import { AbstractPacketManager } from '../../default/AbstractPacketManager.js';
import { DiscoverPacket, IDiscover } from '../../protobuf/packets/peering/DiscoveryPacket.js';
import {
    IDiscoveryResponse,
    OPNetPeerInfo,
} from '../../protobuf/packets/peering/DiscoveryResponsePacket.js';
import { Packets } from '../../protobuf/types/enums/Packets.js';
import { ServerInBound } from '../../protobuf/types/messages/OPNetMessages.js';
import { OPNetPacket } from '../../protobuf/types/OPNetPacket.js';
import { OPNetProtocolV1 } from '../protocol/OPNetProtocolV1.js';

export class ServerPeerManager extends AbstractPacketManager {
    constructor(
        protocol: OPNetProtocolV1,
        peerId: string,
        selfIdentity: OPNetIdentity | undefined,
    ) {
        super(protocol, peerId, selfIdentity);
    }

    public async onPacket(packet: OPNetPacket): Promise<boolean> {
        switch (packet.opcode) {
            case ServerInBound.DISCOVER:
                await this.onDiscover(packet);
                break;
            default:
                return false;
        }

        return true;
    }

    public getOPNetPeers: () => Promise<OPNetPeerInfo[]> = () => {
        throw new Error('getOPNetPeers not implemented.');
    };

    public destroy(): void {
        super.destroy();
    }

    private async buildDiscoveryResponse(): Promise<void> {
        const packet = this.protocol.getPacketBuilder(Packets.DiscoveryResponse);
        if (!packet) {
            return;
        }

        const discoverResponseData: IDiscoveryResponse = {
            peers: await this.getOPNetPeers(),
        };

        await this.sendMsg(packet.pack(discoverResponseData));
    }

    private async onDiscover(packet: OPNetPacket): Promise<void> {
        const discoverPacket = (await this.protocol.onIncomingPacket<IDiscover>(
            packet,
        )) as DiscoverPacket;

        if (!discoverPacket) {
            return;
        }

        const unpackedPacket = discoverPacket.unpack(packet.packet);
        if (!unpackedPacket) {
            return;
        }

        await this.buildDiscoveryResponse();
    }
}
