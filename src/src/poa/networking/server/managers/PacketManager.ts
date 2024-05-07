import { Type } from 'protobufjs';
import { ClientKeyCipherExchange } from '../../protobuf/packets/authentication/exchange/ClientKeyCipherExchange.js';
import { ServerKeyCipherExchange } from '../../protobuf/packets/authentication/exchange/ServerKeyCipherExchange.js';
import { AuthenticationPacket } from '../../protobuf/packets/authentication/OPNetAuthentication.js';
import { AuthenticationStatus } from '../../protobuf/packets/authentication/status/AuthentificationStatus.js';
import { Ping } from '../../protobuf/packets/latency/Ping.js';
import { Pong } from '../../protobuf/packets/latency/Pong.js';
import { PackedMessage, Packet } from '../../protobuf/packets/Packet.js';
import { ProtobufLoader } from '../../protobuf/PotobufLoader.js';
import { Packets } from '../../protobuf/types/enums/Packets.js';

type PacketBuilders = { [key in Packets]: Packet<PackedMessage, PackedMessage, PackedMessage> };

export class OPNetPacketManager extends ProtobufLoader {
    public logColor: string = `#59dccd`;

    private packetBuilders: PacketBuilders = {
        [Packets.Authentication]: new AuthenticationPacket(
            this.getProtobufType(AuthenticationPacket.TYPE),
        ),
        [Packets.ClientKeyCipherExchange]: new ClientKeyCipherExchange(
            this.getProtobufType(ClientKeyCipherExchange.TYPE),
        ),
        [Packets.AuthenticationStatus]: new AuthenticationStatus(
            this.getProtobufType(AuthenticationStatus.TYPE),
        ),
        [Packets.Ping]: new Ping(this.getProtobufType(Ping.TYPE)),
        [Packets.ServerKeyCipherExchange]: new ServerKeyCipherExchange(
            this.getProtobufType(ServerKeyCipherExchange.TYPE),
        ),
        [Packets.Pong]: new Pong(this.getProtobufType(Pong.TYPE)),
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
