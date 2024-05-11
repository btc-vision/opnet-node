import { BitcoinNetwork } from '@btc-vision/bsi-common';
import { Type } from 'protobufjs';
import { ChainIds } from '../../../../../config/enums/ChainIds.js';
import { OPNetIndexerMode } from '../../../../../config/interfaces/OPNetIndexerMode.js';
import { Packets } from '../../types/enums/Packets.js';
import { ServerOutBound } from '../../types/messages/OPNetMessages.js';
import { PackedMessage, Packet } from '../Packet.js';

export interface OPNetPeerInfo {
    readonly opnetVersion: string;
    readonly identity: string;
    readonly type: OPNetIndexerMode;
    readonly network: BitcoinNetwork;
    readonly chainId: ChainIds;
}

export interface IDiscoveryResponse extends PackedMessage {
    readonly peers: OPNetPeerInfo[];
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
