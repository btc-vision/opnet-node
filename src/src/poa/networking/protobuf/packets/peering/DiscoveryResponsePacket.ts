import { Type } from 'protobufjs';
import { ChainIds } from '../../../../../config/enums/ChainIds.js';
import { Packets } from '../../types/enums/Packets.js';
import { ServerOutBound } from '../../types/messages/OPNetMessages.js';
import { PackedMessage, Packet } from '../Packet.js';

export interface OPNetPeerInfo {
    readonly opnetVersion: string;
    readonly identity: string;
    readonly type: number;
    readonly network: number;
    readonly chainId: ChainIds;
    readonly peer: Uint8Array;
    readonly addresses: Uint8Array[];
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

    public pack(msgToPack: IDiscoveryResponse): Uint8Array {
        let convertedMsgToPack = this.castInputAs(msgToPack as unknown as IDiscoveryResponse);
        let verificationError = this.packet.verify(convertedMsgToPack);

        if (verificationError) {
            throw new Error(`Error while verifying message: ${verificationError}`);
        } else {
            let schema = this.packet.create(convertedMsgToPack);
            console.log('schema', msgToPack.peers[0].addresses);

            let message = this.packet.encode(schema).finish();
            console.log('message', message);

            if (this.opcode === null) throw new Error(`Opcode is null.`);

            return new Uint8Array([this.opcode, ...message]);
        }
    }
}
