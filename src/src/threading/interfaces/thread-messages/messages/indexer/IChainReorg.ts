export interface IChainReorg {
    fromHeight: bigint;
    toHeight: bigint;
    newBest: string;
}
