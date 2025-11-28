import { JSONRpcMethods } from '../../../enums/JSONRpcMethods.js';
import { JSONRpcParams } from '../../JSONRpcParams.js';
import {
    StrippedTransactionInput,
    StrippedTransactionInputAPI,
} from '../../../../../../blockchain-indexer/processor/transaction/inputs/TransactionInput.js';
import {
    StrippedTransactionOutput,
    StrippedTransactionOutputAPI,
} from '../../../../../../blockchain-indexer/processor/transaction/inputs/TransactionOutput.js';
import { AccessList, LoadedStorageList } from '../../results/states/CallResult.js';

export interface SimulatedTransaction {
    readonly inputs: StrippedTransactionInputAPI[];
    readonly outputs: StrippedTransactionOutputAPI[];
}

export interface ParsedSimulatedTransaction {
    readonly inputs: StrippedTransactionInput[];
    readonly outputs: StrippedTransactionOutput[];
}

export interface CallParamsAsObject extends JSONRpcParams<JSONRpcMethods.CALL> {
    readonly to: string;
    readonly calldata: string;

    readonly from?: string;
    readonly fromLegacy?: string;
    readonly blockNumber?: string;

    readonly transaction?: Partial<SimulatedTransaction>;
    readonly accessList?: Partial<AccessList>;
    readonly preloadStorage?: Partial<LoadedStorageList>;
}

export type CallParamsAsArray = [
    string,
    string,
    string?,
    string?,
    string?,
    Partial<SimulatedTransaction>?,
    Partial<AccessList>?,
    Partial<LoadedStorageList>?,
];

export type CallParams = CallParamsAsObject | CallParamsAsArray;
