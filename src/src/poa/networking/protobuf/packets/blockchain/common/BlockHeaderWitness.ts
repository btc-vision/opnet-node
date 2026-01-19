import Long from 'long';
import { Type } from 'protobufjs';
import { Packets } from '../../../types/enums/Packets.js';
import { CommonPackets } from '../../../types/messages/OPNetMessages.js';
import { PackedMessage, Packet } from '../../Packet.js';

export interface OPNetBlockWitness {
    identity?: string;

    readonly publicKey?: Buffer;
    readonly signature: Buffer;
    readonly timestamp: Long;
}

export interface ChecksumProof {
    readonly proof: string[];
}

export interface IBlockHeaderWitness extends PackedMessage {
    readonly blockNumber: Long | bigint;

    readonly blockHash: string;
    readonly previousBlockHash: string | null;

    readonly merkleRoot: string;
    readonly receiptRoot: string;
    readonly storageRoot: string;

    readonly checksumHash: string;
    readonly checksumProofs: ChecksumProof[];
    readonly previousBlockChecksum: string;

    readonly txCount: number;

    readonly validatorWitnesses: OPNetBlockWitness[];
    readonly trustedWitnesses: OPNetBlockWitness[];
}

/** Broadcast goes both ways */
export class BlockHeaderWitnessPacket extends Packet<
    IBlockHeaderWitness,
    IBlockHeaderWitness,
    IBlockHeaderWitness
> {
    public static TYPE: Packets = Packets.BlockHeaderWitness;

    protected readonly opcode: CommonPackets = CommonPackets.BLOCK_HEADER_WITNESS;

    public constructor(protobufType: Type) {
        super(protobufType);
    }
}
