import { OPNetBlockWitness } from '../../poa/networking/protobuf/packets/blockchain/BlockHeaderWitness.js';

export interface BlockWitnessDocument extends OPNetBlockWitness {
    readonly blockNumber: bigint;
    readonly trusted: boolean;
}
