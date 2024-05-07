import { ClientKeyCipherExchange } from '../../protobuf/packets/authentication/exchange/ClientKeyCipherExchange.js';
import { ServerKeyCipherExchange } from '../../protobuf/packets/authentication/exchange/ServerKeyCipherExchange.js';
import { AuthenticationPacket } from '../../protobuf/packets/authentication/OPNetAuthentication.js';
import { AuthenticationStatus } from '../../protobuf/packets/authentication/status/AuthentificationStatus.js';
import { Ping } from '../../protobuf/packets/latency/Ping.js';
import { Pong } from '../../protobuf/packets/latency/Pong.js';
import { PackedMessage, Packet } from '../../protobuf/packets/Packet.js';
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

    public async onIncomingPacket<T extends PackedMessage>(
        packet: OPNetPacket,
    ): Promise<Packet<T, PackedMessage, PackedMessage> | null> {
        if (!this.opnetProtocol) return null;

        const packetHandler = this.opnetProtocol[packet.opcode];
        if (!packetHandler) {
            throw new Error(`Invalid packet opcode: ${packet.opcode}`);
        }

        return packetHandler() as Packet<T, PackedMessage, PackedMessage>;
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
            [CommonPackets.PONG]: this.handlePongPacket,
            [ServerInBound.PING]: this.handlePingPacket,
        };
    }

    private useAuthHandshakeProtocol(): void {
        this.opnetProtocol = {
            ...this.commonProtocol(),

            [ServerInBound.AUTHENTICATION]: this.handleAuthenticationPacket,
            [ServerInBound.CLIENT_CIPHER_EXCHANGE]: this.handleClientCipherExchange,

            [ServerOutBound.AUTHENTICATION_STATUS]: this.handleAuthenticationStatusPacket,
            [ServerOutBound.SERVER_CIPHER_EXCHANGE]: this.handleServerCipherExchangePacket,
        };
    }
}
