import { TransactionData } from '@btc-vision/bitcoin-rpc';
import { TransactionSafeThread } from '../../db/interfaces/ITransactionDocument.js';

export interface MsgFromMain {
    id: number;
    data: TransactionData;
    vIndexIn: number;
    blockHash: string;
    blockHeight: bigint;
    allowedPreimages: string[];
}

export interface MsgResult {
    id: number;
    result: TransactionSafeThread;
}

export interface MsgError {
    id: number;
    error: string;
}

export type MsgToMain = MsgResult | MsgError;

export interface ParseTask {
    data: TransactionData;
    vIndexIn: number;
    blockHash: string;
    blockHeight: bigint;
    allowedPreimages: string[];
}

export type ProcessTask = (data: ParseTask) => Promise<TransactionSafeThread>;
