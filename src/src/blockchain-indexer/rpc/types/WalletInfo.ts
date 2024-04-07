export enum DatabaseFormat {
    Bdb = 'bdb',
    Sqlite = 'sqlite',
}

export interface WalletScanningDetails {
    duration: number;
    progress: number;
}

export interface WalletInfo {
    walletname: string;
    walletversion: number;
    format: DatabaseFormat;

    balance: number; // Deprecated
    unconfirmed_balance: number; // Deprecated
    immature_balance: number; // Deprecated

    txcount: number;
    keypoololdest: number;
    keypoolsize: number;
    keypoolsize_hd_internal: number;
    unlocked_until?: number; // Optional
    paytxfee: number;
    hdseedid?: string; // Optional
    private_keys_enabled: boolean;
    avoid_reuse: boolean;
    scanning: WalletScanningDetails | boolean;
    descriptors: boolean;
}
