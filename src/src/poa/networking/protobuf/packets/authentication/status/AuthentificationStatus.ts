import { Type } from 'protobufjs';
import { OPNetAuthenticationStatus } from '../../../types/enums/OPNetAuthentificationStatus.js';
import { Packets } from '../../../types/enums/Packets.js';
import { ServerOutBound } from '../../../types/messages/OPNetMessages.js';

import { PackedMessage, Packet } from '../../Packet.js';

export interface IAuthenticationStatusPacket extends PackedMessage {
    readonly status: OPNetAuthenticationStatus;
    readonly message: string;

    readonly challenge?: Uint8Array;
}

export class AuthenticationStatus extends Packet<
    IAuthenticationStatusPacket,
    IAuthenticationStatusPacket,
    IAuthenticationStatusPacket
> {
    public static TYPE: Packets = Packets.AuthenticationStatus;

    protected opcode: ServerOutBound = ServerOutBound.AUTHENTICATION_STATUS;

    constructor(protobufType: Type) {
        super(protobufType);
    }
}
