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
import { Packets } from '../../protobuf/types/enums/Packets.js';
import {
    CommonPackets,
    PossiblePackets,
    ServerInBound,
    ServerOutBound,
} from '../../protobuf/types/messages/OPNetMessages.js';
import { OPNetPacket } from '../../protobuf/types/OPNetPacket.js';
import { PacketManager } from '../managers/PacketManager.js';

type ProtocolV1Inbound = {
    [key in PossiblePackets]: () => Packet<PackedMessage, PackedMessage, PackedMessage>;
};

export class OPNetProtocolV1 {
    protected opnetProtocol: Partial<ProtocolV1Inbound> | undefined;

    constructor() {
        this.useAuthHandshakeProtocol();
    }

    public onAuthenticated(): void {
        this.opnetProtocol = {
            ...this.commonProtocol(),
            [ServerInBound.DISCOVER]: () => this.handleDiscoveryPacket(),
            [ServerOutBound.DISCOVERY_RESPONSE]: () => this.handleDiscoveryResponsePacket(),
            [CommonPackets.BLOCK_HEADER_WITNESS]: () => this.handleBlockHeaderWitnessPacket(),

            /** Sync */
            [ServerInBound.SYNC_BLOCK_HEADERS_REQUEST]: () => this.handleSyncBlockHeadersRequest(),
            [ServerOutBound.SYNC_BLOCK_HEADERS_RESPONSE]: () =>
                this.handleSyncBlockHeadersResponse(),

            /** Transaction */
            [CommonPackets.BROADCAST_TRANSACTION]: () => this.handleTransactionBroadcast(),
        };
    }

    public getPacketBuilder<
        T extends PackedMessage = PackedMessage,
        I extends PackedMessage = PackedMessage,
        J extends PackedMessage = PackedMessage,
    >(packet: Packets): Packet<T, I, J> | undefined {
        return PacketManager.getPacketBuilder(packet) as Packet<T, I, J> | undefined;
    }

    public destroy(): void {
        delete this.opnetProtocol;
    }

    public onIncomingPacket<T extends PackedMessage>(
        packet: OPNetPacket,
    ): Packet<T, PackedMessage, PackedMessage> | null {
        if (!this.opnetProtocol) return null;

        const packetHandler = this.opnetProtocol[packet.opcode];
        if (!packetHandler) {
            throw new Error(`Invalid packet opcode: ${packet.opcode}`);
        }

        return packetHandler() as Packet<T, PackedMessage, PackedMessage>;
    }

    private handleTransactionBroadcast(): TransactionPacket {
        return PacketManager.getPacketBuilder(Packets.BroadcastTransaction) as TransactionPacket;
    }

    private handleSyncBlockHeadersRequest(): SyncBlockHeadersRequest {
        return PacketManager.getPacketBuilder(
            Packets.SyncBlockHeadersRequest,
        ) as SyncBlockHeadersRequest;
    }

    private handleSyncBlockHeadersResponse(): SyncBlockHeadersResponse {
        return PacketManager.getPacketBuilder(
            Packets.SyncBlockHeadersResponse,
        ) as SyncBlockHeadersResponse;
    }

    private handleBlockHeaderWitnessPacket(): BlockHeaderWitnessPacket {
        return PacketManager.getPacketBuilder(
            Packets.BlockHeaderWitness,
        ) as BlockHeaderWitnessPacket;
    }

    private handleDiscoveryResponsePacket(): DiscoveryResponsePacket {
        return PacketManager.getPacketBuilder(Packets.DiscoveryResponse) as DiscoveryResponsePacket;
    }

    private handleDiscoveryPacket(): DiscoverPacket {
        return PacketManager.getPacketBuilder(Packets.Discover) as DiscoverPacket;
    }

    private handleAuthenticationPacket(): AuthenticationPacket {
        return PacketManager.getPacketBuilder(Packets.Authentication) as AuthenticationPacket;
    }

    private handleClientCipherExchange(): ClientKeyCipherExchange {
        return PacketManager.getPacketBuilder(
            Packets.ClientKeyCipherExchange,
        ) as ClientKeyCipherExchange;
    }

    private handlePingPacket(): Ping {
        return PacketManager.getPacketBuilder(Packets.Ping) as Ping;
    }

    private handlePongPacket(): Pong {
        return PacketManager.getPacketBuilder(Packets.Pong) as Pong;
    }

    private handleAuthenticationStatusPacket(): AuthenticationStatus {
        return PacketManager.getPacketBuilder(Packets.AuthenticationStatus) as AuthenticationStatus;
    }

    private handleServerCipherExchangePacket(): ServerKeyCipherExchange {
        return PacketManager.getPacketBuilder(
            Packets.ServerKeyCipherExchange,
        ) as ServerKeyCipherExchange;
    }

    private commonProtocol(): Partial<ProtocolV1Inbound> {
        return {
            [CommonPackets.PONG]: () => this.handlePongPacket(),
            [ServerInBound.PING]: () => this.handlePingPacket(),
        };
    }

    private useAuthHandshakeProtocol(): void {
        this.opnetProtocol = {
            ...this.commonProtocol(),

            [ServerInBound.AUTHENTICATION]: () => this.handleAuthenticationPacket(),
            [ServerInBound.CLIENT_CIPHER_EXCHANGE]: () => this.handleClientCipherExchange(),

            [ServerOutBound.AUTHENTICATION_STATUS]: () => this.handleAuthenticationStatusPacket(),
            [ServerOutBound.SERVER_CIPHER_EXCHANGE]: () => this.handleServerCipherExchangePacket(),
        };
    }
}
