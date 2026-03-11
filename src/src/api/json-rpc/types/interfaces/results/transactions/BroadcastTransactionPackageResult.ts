export interface ApiTestMempoolAcceptFees {
    readonly base: number;
    readonly effectiveFeerate: number;
    readonly effectiveIncludes: string[];
}

export interface ApiTestMempoolAcceptResult {
    readonly txid: string;
    readonly wtxid: string;
    readonly packageError?: string;
    readonly allowed?: boolean;
    readonly vsize?: number;
    readonly fees?: ApiTestMempoolAcceptFees;
    readonly rejectReason?: string;
    readonly rejectDetails?: string;
}

export interface ApiPackageTxFees {
    readonly base: number;
    readonly effectiveFeerate?: number;
    readonly effectiveIncludes?: string[];
}

export interface ApiPackageTxResult {
    readonly txid: string;
    readonly otherWtxid?: string;
    readonly vsize?: number;
    readonly fees?: ApiPackageTxFees;
    readonly error?: string;
}

export interface ApiPackageResult {
    readonly packageMsg: string;
    readonly txResults: {
        [wtxid: string]: ApiPackageTxResult;
    };
    readonly replacedTransactions?: string[];
}

export interface SequentialBroadcastTxResult {
    readonly txid: string;
    readonly success: boolean;
    readonly error?: string;
    readonly peers?: number;
}

export interface BroadcastTransactionPackageResult {
    readonly success: boolean;
    readonly error?: string;

    /** Present on isPackage=false or fallback path */
    readonly testResults?: ApiTestMempoolAcceptResult[];

    /** Present on isPackage=true success */
    readonly packageResult?: ApiPackageResult;

    /** Present on sequential broadcast (isPackage=false or fallback) */
    readonly sequentialResults?: SequentialBroadcastTxResult[];

    /** True when submitPackage failed and we fell back to sequential */
    readonly fellBackToSequential?: boolean;
}
