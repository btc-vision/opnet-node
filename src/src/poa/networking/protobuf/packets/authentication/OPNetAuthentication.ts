import { Type } from 'protobufjs';
import { Packets } from '../../types/enums/Packets.js';
import { ServerInBound, ServerOutBound } from '../../types/messages/OPNetMessages.js';
import { PackedMessage, Packet } from '../Packet.js';
import { TrustedVersion } from '../../../../configurations/version/TrustedVersion.js';

export interface IAuthenticationPacket extends PackedMessage {
    readonly version: TrustedVersion;
    readonly clientAuthCipher: Uint8Array;
    readonly trustedChecksum: string;
    readonly type: number;
    readonly network: number;
    readonly chainId: number;

    magicNumber?: number;
}

export class AuthenticationPacket extends Packet<IAuthenticationPacket, object, object> {
    public static TYPE: Packets = Packets.Authentication;

    protected opcode: ServerInBound | ServerOutBound = ServerInBound.AUTHENTICATION;

    public constructor(protobufType: Type) {
        super(protobufType);
    }
}
