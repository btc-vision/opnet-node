import {
    PackageResult,
    TestMempoolAcceptResult,
} from '@btc-vision/bitcoin-rpc';

export interface SequentialBroadcastTxResult {
    readonly txid: string;
    readonly success: boolean;
    readonly error?: string;
}

export interface BroadcastTransactionPackageResult {
    readonly success: boolean;
    readonly error?: string;

    /** Present on isPackage=false or fallback path */
    readonly testResults?: TestMempoolAcceptResult[];

    /** Present on isPackage=true success */
    readonly packageResult?: PackageResult;

    /** Present on sequential broadcast (isPackage=false or fallback) */
    readonly sequentialResults?: SequentialBroadcastTxResult[];

    /** True when submitPackage failed and we fell back to sequential */
    readonly fellBackToSequential?: boolean;
}
