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
import { AccessList } from '../../results/states/CallResult.js';

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
    readonly blockNumber?: string;

    readonly transaction?: Partial<SimulatedTransaction>;
    readonly accessList?: Partial<AccessList>;
}

export type CallParamsAsArray = [
    string,
    string,
    string?,
    string?,
    Partial<SimulatedTransaction>?,
    Partial<AccessList>?,
];

export type CallParams = CallParamsAsObject | CallParamsAsArray;
