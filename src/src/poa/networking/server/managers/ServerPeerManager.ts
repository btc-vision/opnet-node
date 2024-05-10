import { OPNetIdentity } from '../../../identity/OPNetIdentity.js';
import { AbstractPacketManager } from '../../default/AbstractPacketManager.js';
import { DiscoverPacket, IDiscover } from '../../protobuf/packets/peering/DiscoveryPacket.js';
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

    public destroy(): void {
        super.destroy();
    }

    private async onDiscover(packet: OPNetPacket): Promise<void> {
        this.info(`Peer ${this.peerId} got a discover packet.`);

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

        console.log(`discover packet`, unpackedPacket);
    }
}
