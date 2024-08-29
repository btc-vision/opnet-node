export interface SynchronisationStatus {
    currentBlockHeight: bigint;
    targetBlockHeight: bigint;

    isSyncing: boolean;
    isReorging: boolean;
    //isRecovering: boolean;

    bestBlockHash: string | null;
    isDownloading: boolean;
}
