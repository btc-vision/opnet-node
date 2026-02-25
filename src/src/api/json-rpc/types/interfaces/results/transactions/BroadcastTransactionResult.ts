import { OPNetTransactionTypes } from '../../../../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';

interface IBroadcastTransactionResult {
    success: boolean;
    result?: string;
    error?: string;
    peers?: number;

    identifier?: bigint;
    modifiedTransaction?: string;
    finalizedTransaction?: boolean;
    transactionType?: OPNetTransactionTypes;
}

export type BroadcastTransactionResult = IBroadcastTransactionResult;
