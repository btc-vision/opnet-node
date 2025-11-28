import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';
import { EpochSubmissionAPIResult } from '../../../../../../db/documents/interfaces/IEpochSubmissionsDocument.js';

export interface APIEpochMiner {
    readonly solution: string;
    readonly mldsaPublicKey: string;
    readonly legacyPublicKey: string;
    readonly salt: string;
    readonly graffiti?: string;
}

export interface EpochAPIResult {
    readonly epochNumber: string;
    readonly epochHash: string;
    readonly epochRoot: string;

    readonly startBlock: string;
    readonly endBlock: string;

    readonly difficultyScaled: string;
    readonly minDifficulty?: string;

    readonly targetHash: string;

    readonly proposer: APIEpochMiner;
    readonly proofs: string[];

    submissions?: EpochSubmissionAPIResult[];
}

export type EpochResult = JSONRpc2ResultData<
    JSONRpcMethods.GET_EPOCH_BY_NUMBER | JSONRpcMethods.GET_EPOCH_BY_HASH
> &
    EpochAPIResult;
