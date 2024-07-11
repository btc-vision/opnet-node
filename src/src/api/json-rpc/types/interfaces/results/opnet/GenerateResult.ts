import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpc2ResultData } from '../../JSONRpc2ResultData.js';
import { GenerateTarget } from '../../params/opnet/GenerateParams.js';
import { VaultUTXOs as AdaptedVaultUTXOs } from '@btc-vision/transaction';

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

export interface WrappedGenerationResult {
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

export interface UnwrappedGenerationResult {
    /** Selected vault UTXOs */
    readonly vaultUTXOs: AdaptedVaultUTXOs[];

    /** WBTC balance */
    readonly balance: string;
}

export type PartialGeneratedResult<T extends GenerateTarget> = T extends GenerateTarget.WRAP
    ? WrappedGenerationResult
    : T extends GenerateTarget.UNWRAP
      ? UnwrappedGenerationResult
      : never;

export type GeneratedResult<T extends GenerateTarget> =
    | (JSONRpc2ResultData<JSONRpcMethods.GENERATE> & PartialGeneratedResult<T>)
    | {
          error: string;
      };
