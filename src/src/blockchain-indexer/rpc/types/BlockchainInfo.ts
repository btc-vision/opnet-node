export enum BitcoinChains {
    TESTNET = 'test',
    REGTEST = 'regtest',
    MAINNET = 'main',
    SIGNET = 'sign',
}

export enum SoftforkType {
    Buried = 'buried',
    Bip9 = 'bip9',
}

export enum Softfork {
    Taproot = 'taproot',
    Segwit = 'segwit',
}

export enum Bip9Status {
    Defined = 'defined',
    Started = 'started',
    LockedIn = 'locked_in',
    Active = 'active',
    Failed = 'failed',
}

export interface SoftforkBip9Detail {
    status: Bip9Status;
    bit?: number;
    start_time?: number;
    timeout?: number;
    since: number;
    statistics?: {
        period: number;
        threshold: number;
        elapsed: number;
        count: number;
        possible: boolean;
    };
}

export interface SoftforkDetail {
    type: SoftforkType;
    bip9?: SoftforkBip9Detail;
    height?: number;
    active: boolean;
}

export interface BlockchainInfo {
    chain: string;
    blocks: number;
    headers: number;
    bestblockhash: string;
    difficulty: number;
    mediantime: number;
    verificationprogress: number;
    initialblockdownload: boolean;
    chainwork: string;
    size_on_disk: number;
    pruned: boolean;
    pruneheight?: number;
    automatic_pruning?: boolean;
    prune_target_size?: number;
    softforks: { [key in Softfork]?: SoftforkDetail };
    warnings: string;
}
