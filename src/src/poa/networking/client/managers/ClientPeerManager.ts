import { OPNetIdentity } from '../../../identity/OPNetIdentity.js';
import { AbstractPacketManager } from '../../default/AbstractPacketManager.js';
import { IDiscover } from '../../protobuf/packets/peering/DiscoveryPacket.js';
import {
    DiscoveryResponsePacket,
    IDiscoveryResponse,
} from '../../protobuf/packets/peering/DiscoveryResponsePacket.js';
import { Packets } from '../../protobuf/types/enums/Packets.js';
import { ServerOutBound } from '../../protobuf/types/messages/OPNetMessages.js';
import { OPNetPacket } from '../../protobuf/types/OPNetPacket.js';
import { AuthenticationManager } from '../../server/managers/AuthenticationManager.js';
import { OPNetProtocolV1 } from '../../server/protocol/OPNetProtocolV1.js';
import { PeerHandlerEvents } from '../events/PeerHandlerEvents.js';
import { Config } from '../../../../config/Config.js';
import { DebugLevel } from '@btc-vision/bsi-common';

export class ClientPeerManager extends AbstractPacketManager {
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
            case ServerOutBound.DISCOVERY_RESPONSE:
                await this.onDiscoveryResponse(packet);
                break;

            default:
                return false;
        }

        return true;
    }

    public destroy(): void {
        super.destroy();
    }

    public async discoverPeers(): Promise<void> {
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
        if (Config.DEBUG_LEVEL >= DebugLevel.TRACE) {
            this.info(`Peer ${this.peerId} got discovery a response.`);
        }

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
    }
}
