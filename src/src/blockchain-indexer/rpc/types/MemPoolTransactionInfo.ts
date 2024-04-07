import { BitcoinVerbosity } from './BitcoinVerbosity.js';

export interface FeesInfo {
    base: number;
    modified: number;
    ancestor: number;
    descendant: number;
}

export interface RawMemPoolTransactionInfo {
    vsize: number;
    weight: number;
    fee?: number;
    modifiedfee?: number;
    time: number;
    height: number;
    descendantcount: number;
    descendantsize: number;
    descendantfees?: number;
    ancestorcount: number;
    ancestorsize: number;
    ancestorfees?: number;
    wtxid: string;
    fees: FeesInfo;
    depends: string[];
    spentby: string[];
    bip125_replaceable: boolean;
    unbroadcast: boolean;
}

export type MemPoolTransactionInfo<V extends BitcoinVerbosity> = V extends BitcoinVerbosity.RAW
    ? string[]
    : RawMemPoolTransactionInfo;
