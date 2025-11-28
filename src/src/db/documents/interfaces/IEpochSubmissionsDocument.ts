import { Binary, Decimal128 } from 'mongodb';
import { IEpochMiner } from './IEpochDocument.js';
import { APIEpochMiner } from '../../../api/json-rpc/types/interfaces/results/epochs/EpochResult.js';

export interface IEpochSubmissionsDocument {
    readonly confirmedAt: Decimal128;
    readonly epochNumber: Decimal128;
    readonly startBlock: Decimal128;

    readonly submissionTxId: Binary;
    readonly submissionTxHash: Binary;

    readonly submissionHash: Binary;

    readonly epochProposed: IEpochMiner;
}

export interface EpochSubmissionWinner {
    readonly epochNumber: bigint;
    readonly matchingBits: number;
    readonly salt: Buffer;
    readonly mldsaPublicKey: Buffer;
    readonly legacyPublicKey: Buffer;
    readonly solutionHash: Buffer;
    readonly graffiti: Buffer;
}

export interface EpochSubmissionAPIResult {
    readonly confirmedAt: string;

    readonly submissionTxId: string;
    readonly submissionTxHash: string;
    readonly submissionHash: string;

    readonly epochProposed: APIEpochMiner;
}
