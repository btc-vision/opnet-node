import { Type } from 'protobufjs';
import { OPNetAuthenticationStatus } from '../../../types/enums/OPNetAuthentificationStatus.js';
import { Packets } from '../../../types/enums/Packets.js';
import { ServerOutBound } from '../../../types/messages/OPNetMessages.js';

import { PackedMessage, Packet } from '../../Packet.js';

export interface IAuthenticationStatusPacket extends PackedMessage {
    status: OPNetAuthenticationStatus;
    message: string;
}

export class AuthenticationStatus extends Packet<IAuthenticationStatusPacket, {}, {}> {
    public static TYPE: Packets = Packets.AuthenticationStatus;

    protected opcode: ServerOutBound = ServerOutBound.AUTHENTICATION_STATUS;

    constructor(protobufType: Type) {
        super(protobufType);
    }
}
