import { Type } from 'protobufjs';
import { Packets } from '../../../types/enums/Packets.js';
import { ServerOutBound } from '../../../types/messages/OPNetMessages.js';
import { PackedMessage, Packet } from '../../Packet.js';

export interface IServerKeyCipherExchangePacket extends PackedMessage {
    serverKeyCipher: Buffer;
    serverSigningCipher: Buffer;
    encryptionEnabled: boolean;
}

export class ServerKeyCipherExchange extends Packet<
    IServerKeyCipherExchangePacket,
    IServerKeyCipherExchangePacket,
    IServerKeyCipherExchangePacket
> {
    public static TYPE: Packets = Packets.ServerKeyCipherExchange;

    protected opcode: ServerOutBound = ServerOutBound.SERVER_CIPHER_EXCHANGE;

    public constructor(protobufType: Type) {
        super(protobufType);
    }
}
