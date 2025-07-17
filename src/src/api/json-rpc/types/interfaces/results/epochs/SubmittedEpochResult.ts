import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';

export enum SubmissionStatus {
    ACCEPTED = 'accepted',
    REJECTED = 'rejected',
    PENDING = 'pending',
}

export interface APISubmittedEpochResult {
    readonly epochNumber: string;
    readonly submissionHash: string;
    readonly difficulty: number;
    readonly timestamp: number;
    readonly status: SubmissionStatus;
    readonly message?: string;
}

export type SubmittedEpochResult = JSONRpc2ResultData<JSONRpcMethods.SUBMIT_EPOCH> &
    APISubmittedEpochResult;
