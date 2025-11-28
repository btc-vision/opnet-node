import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';

export interface SubmitEpochParamsAsObject extends JSONRpcParams<JSONRpcMethods.SUBMIT_EPOCH> {
    readonly epochNumber: string;

    readonly targetHash: string;
    readonly salt: string;
    readonly mldsaPublicKey: string;

    readonly graffiti?: string;
    readonly signature: string;
}

export type SubmitEpochParamsAsArray = [SubmitEpochParamsAsObject];

export type SubmitEpochParams = SubmitEpochParamsAsObject | SubmitEpochParamsAsArray;
