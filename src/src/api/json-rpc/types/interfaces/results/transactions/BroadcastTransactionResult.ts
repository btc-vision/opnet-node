interface IBroadcastTransactionResult {
    success: boolean;
    result?: string;
    error?: string;
    peers?: number;

    identifier?: bigint;
    modifiedTransaction?: string;
    finalizedTransaction?: boolean;
    transactionType?: string;
}

export type BroadcastTransactionResult = IBroadcastTransactionResult;
