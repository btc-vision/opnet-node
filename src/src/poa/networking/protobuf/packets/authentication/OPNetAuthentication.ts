import { Type } from 'protobufjs';
import { Packets } from '../../types/enums/Packets.js';
import { ServerInBound, ServerOutBound } from '../../types/messages/OPNetMessages.js';
import { PackedMessage, Packet } from '../Packet.js';

export interface IAuthenticationPacket extends PackedMessage {
    readonly version: string;
    readonly clientAuthCipher?: Uint8Array;
}

export class AuthenticationPacket extends Packet<IAuthenticationPacket, {}, {}> {
    public static TYPE: Packets = Packets.Authentication;

    protected opcode: ServerInBound | ServerOutBound = ServerInBound.AUTHENTICATION;

    constructor(protobufType: Type) {
        super(protobufType);
    }
}
