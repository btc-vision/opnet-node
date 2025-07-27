export interface PreimageResult {
    readonly epochNumber: string;
    readonly publicKey: string;
    readonly solution: string;
    readonly salt: string;
    readonly graffiti: string;
    readonly difficulty: number;

    readonly verification: {
        readonly epochHash: string;
        readonly epochRoot: string;
        readonly targetHash: string;
        readonly targetChecksum: string;
        readonly startBlock: string;
        readonly endBlock: string;
        readonly proofs: string[];
    };
}
