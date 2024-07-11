import { Type } from 'protobufjs';
import { Packets } from '../../../types/enums/Packets.js';
import { ServerInBound } from '../../../types/messages/OPNetMessages.js';
import { PackedMessage, Packet } from '../../Packet.js';

export interface IClientKeyCipherExchangePacket extends PackedMessage {
    readonly clientKeyCipher: Uint8Array;
    readonly clientAuthCipher: Uint8Array;
    readonly identity: Uint8Array;
    readonly challenge: Uint8Array;
}

export class ClientKeyCipherExchange extends Packet<
    IClientKeyCipherExchangePacket,
    IClientKeyCipherExchangePacket,
    IClientKeyCipherExchangePacket
> {
    public static TYPE: Packets = Packets.ClientKeyCipherExchange;

    protected opcode: ServerInBound = ServerInBound.CLIENT_CIPHER_EXCHANGE;

    constructor(protobufType: Type) {
        super(protobufType);
    }
}
