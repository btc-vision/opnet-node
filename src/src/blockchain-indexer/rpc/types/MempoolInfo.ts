import { BitcoinVerbosity } from './BitcoinVerbosity.js';

export interface RawMempoolInfo {
    loaded: boolean;
    size: number;
    bytes: number;
    usage: number;
    maxmempool: number;
    mempoolminfee: number;
    minrelaytxfee: number;
    unbroadcastcount: number;
}

export type MempoolInfo<V extends BitcoinVerbosity> = V extends BitcoinVerbosity.RAW
    ? string
    : RawMempoolInfo;
