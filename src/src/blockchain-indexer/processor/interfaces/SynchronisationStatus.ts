export interface SynchronisationStatus {
    pendingBlockHeight: bigint;
    currentBlockHash: string | null;
    targetBlockHeight: bigint;

    bestTip: bigint;

    initialBlockDownload: boolean;

    isSyncing: boolean;
    isReorging: boolean;
    //isRecovering: boolean;

    bestBlockHash: string | null;
    isDownloading: boolean;

    chain: string | null;
}
