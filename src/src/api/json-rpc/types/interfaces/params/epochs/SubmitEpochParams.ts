import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface SubmitEpochParamsAsObject extends JSONRpcParams<JSONRpcMethods.SUBMIT_EPOCH> {
    readonly epochTarget: string;

    readonly targetHash: string;
    readonly salt: string;
    readonly publicKey: string;

    readonly graffiti?: string;
}

export type SubmitEpochParamsAsArray = [SubmitEpochParamsAsObject];

export type SubmitEpochParams = SubmitEpochParamsAsObject | SubmitEpochParamsAsArray;
