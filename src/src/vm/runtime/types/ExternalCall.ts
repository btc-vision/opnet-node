import { Address } from '@btc-vision/bsi-binary';
import { ContractEvaluation } from '../classes/ContractEvaluation.js';

export type ExternalCallsResult = Map<Address, ContractEvaluation[]>;
export type ExternalCalls = Map<Address, Uint8Array[]>;
