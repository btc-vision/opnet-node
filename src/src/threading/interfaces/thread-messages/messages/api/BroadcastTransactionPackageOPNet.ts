import { PackageResult, TestMempoolAcceptResult } from '@btc-vision/bitcoin-rpc';
import { OPNetTransactionTypes } from '../../../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';

export interface PackageBroadcastTxResult {
    readonly txid: string;
    readonly success: boolean;
    readonly error?: string;
    readonly transactionType?: OPNetTransactionTypes;
}

export interface MempoolPackageBroadcastResponse {
    readonly success: boolean;
    readonly error?: string;
    readonly packageResult?: PackageResult;
    readonly testResults?: TestMempoolAcceptResult[];
    readonly txResults: ReadonlyArray<PackageBroadcastTxResult>;
    readonly fellBackToSequential?: boolean;
}
