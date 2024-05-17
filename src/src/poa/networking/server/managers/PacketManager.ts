import { Type } from 'protobufjs';
import { ClientKeyCipherExchange } from '../../protobuf/packets/authentication/exchange/ClientKeyCipherExchange.js';
import { ServerKeyCipherExchange } from '../../protobuf/packets/authentication/exchange/ServerKeyCipherExchange.js';
import { AuthenticationPacket } from '../../protobuf/packets/authentication/OPNetAuthentication.js';
import { AuthenticationStatus } from '../../protobuf/packets/authentication/status/AuthentificationStatus.js';
import { BlockHeaderWitnessPacket } from '../../protobuf/packets/blockchain/common/BlockHeaderWitness.js';
import { TransactionPacket } from '../../protobuf/packets/blockchain/common/TransactionPacket.js';
import { SyncBlockHeadersRequest } from '../../protobuf/packets/blockchain/requests/SyncBlockHeadersRequest.js';
import { SyncBlockHeadersResponse } from '../../protobuf/packets/blockchain/responses/SyncBlockHeadersResponse.js';
import { Ping } from '../../protobuf/packets/latency/Ping.js';
import { Pong } from '../../protobuf/packets/latency/Pong.js';
import { PackedMessage, Packet } from '../../protobuf/packets/Packet.js';
import { DiscoverPacket } from '../../protobuf/packets/peering/DiscoveryPacket.js';
import { DiscoveryResponsePacket } from '../../protobuf/packets/peering/DiscoveryResponsePacket.js';
import { ProtobufLoader } from '../../protobuf/PotobufLoader.js';
import { Packets } from '../../protobuf/types/enums/Packets.js';

type PacketBuilders = { [key in Packets]: Packet<PackedMessage, PackedMessage, PackedMessage> };

export class OPNetPacketManager extends ProtobufLoader {
    public logColor: string = `#59dccd`;

    private packetBuilders: PacketBuilders = {
        /**
         * Authentication
         */
        [Packets.Authentication]: new AuthenticationPacket(
            this.getProtobufType(AuthenticationPacket.TYPE),
        ),
        [Packets.ClientKeyCipherExchange]: new ClientKeyCipherExchange(
            this.getProtobufType(ClientKeyCipherExchange.TYPE),
        ),
        [Packets.AuthenticationStatus]: new AuthenticationStatus(
            this.getProtobufType(AuthenticationStatus.TYPE),
        ),
        [Packets.ServerKeyCipherExchange]: new ServerKeyCipherExchange(
            this.getProtobufType(ServerKeyCipherExchange.TYPE),
        ),

        /**
         * Latency
         */
        [Packets.Ping]: new Ping(this.getProtobufType(Ping.TYPE)),
        [Packets.Pong]: new Pong(this.getProtobufType(Pong.TYPE)),

        /**
         * Peering
         */
        [Packets.Discover]: new DiscoverPacket(this.getProtobufType(DiscoverPacket.TYPE)),
        [Packets.DiscoveryResponse]: new DiscoveryResponsePacket(
            this.getProtobufType(DiscoveryResponsePacket.TYPE),
        ),

        /**
         * Blockchain
         */
        [Packets.Transaction]: new TransactionPacket(this.getProtobufType(TransactionPacket.TYPE)),
        [Packets.BlockHeaderWitness]: new BlockHeaderWitnessPacket(
            this.getProtobufType(BlockHeaderWitnessPacket.TYPE),
        ),

        /**
         * Sync
         */
        [Packets.SyncBlockHeadersRequest]: new SyncBlockHeadersRequest(
            this.getProtobufType(SyncBlockHeadersRequest.TYPE),
        ),

        [Packets.SyncBlockHeadersResponse]: new SyncBlockHeadersResponse(
            this.getProtobufType(SyncBlockHeadersResponse.TYPE),
        ),
    };

    constructor() {
        super();
    }

    public getPacketBuilder(name: Packets): Packet<PackedMessage, PackedMessage, PackedMessage> {
        return this.packetBuilders[name];
    }

    private getProtobufPath(packet: Packets): string {
        return `OPNetProtocolV1.${packet}`;
    }

    private getProtobufType(name: Packets): Type {
        return this.packetBuilder.lookupType(this.getProtobufPath(name));
    }
}

export const PacketManager: OPNetPacketManager = new OPNetPacketManager();
