import { PossiblePackets } from './messages/OPNetMessages.js';

export interface OPNetPacket {
    readonly packet: Uint8Array;
    readonly opcode: PossiblePackets;
}
