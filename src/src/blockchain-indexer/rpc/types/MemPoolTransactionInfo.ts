export interface FeesInfo {
    base: number;
    modified: number;
    ancestor: number;
    descendant: number;
}

export interface MemPoolTransactionInfo {
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
