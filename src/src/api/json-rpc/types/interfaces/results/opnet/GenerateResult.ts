import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';

export interface GenerationConstraints {
    /** Timestamp of the generation */
    readonly timestamp: number;

    /** Protocol version used for generation */
    readonly version: string;

    /** Minimum different trusted validators */
    readonly minimum: number;

    /** Minimum different trusted validator in a new generated transaction */
    readonly transactionMinimum: number;
}

export interface WrappedGenerationParameters {
    /** Public trusted keys */
    readonly keys: string[];

    /** Vault address (p2ms) */
    readonly vault: string;

    /** Public trusted entities */
    readonly entities: string[];

    /** OPNet Signature that verify the trusted keys and entities */
    readonly signature: string;

    /** Generation constraints */
    readonly constraints: GenerationConstraints;
}

export type GeneratedResult =
    | (JSONRpc2ResultData<JSONRpcMethods.GENERATE> & WrappedGenerationParameters)
    | {
          error: string;
      };
