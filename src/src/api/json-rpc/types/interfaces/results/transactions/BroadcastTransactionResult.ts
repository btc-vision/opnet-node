interface IBroadcastTransactionResult {
    success: boolean;
    result?: string;
    error?: string;
    peers?: number;

    id: string;
    identifier?: bigint;
    modifiedTransaction?: string;
    finalizedTransaction?: boolean;
}

export type BroadcastTransactionResult = IBroadcastTransactionResult;
