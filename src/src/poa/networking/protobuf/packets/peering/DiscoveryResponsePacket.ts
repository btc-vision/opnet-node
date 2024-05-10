import { Type } from 'protobufjs';
import { Packets } from '../../types/enums/Packets.js';
import { ServerOutBound } from '../../types/messages/OPNetMessages.js';
import { PackedMessage, Packet } from '../Packet.js';

export interface PeerInfo {
    readonly identity: Uint8Array;
    readonly opnetVersion: string;
    readonly address: string;
}

export interface IDiscoveryResponse extends PackedMessage {
    readonly peers: PeerInfo[];
}

export class DiscoveryResponsePacket extends Packet<
    IDiscoveryResponse,
    IDiscoveryResponse,
    IDiscoveryResponse
> {
    public static TYPE: Packets = Packets.DiscoveryResponse;

    protected readonly opcode: ServerOutBound = ServerOutBound.DISCOVERY_RESPONSE;

    constructor(protobufType: Type) {
        super(protobufType);
    }
}
