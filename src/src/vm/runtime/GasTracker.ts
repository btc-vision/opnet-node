export class GasTracker {
    public static readonly MAX_GAS: bigint = 480076812288n; // Max gas allowed for a contract execution
    public static readonly SAT_TO_GAS_RATIO: bigint = 18416666n; //100000000n; //30750n; //611805;

    #gasUsed: bigint = 0n;
    #maxGas: bigint;

    private canTrack: boolean = true;

    constructor(private readonly MAX_GAS: bigint = GasTracker.MAX_GAS) {
        this.#maxGas = MAX_GAS;
    }

    public get gasUsed(): bigint {
        return this.#gasUsed;
    }

    public set gasUsed(gasUsed: bigint) {
        this.#gasUsed = gasUsed;
    }

    public get maxGas(): bigint {
        return this.#maxGas;
    }

    public set maxGas(maxGas: bigint) {
        this.#maxGas = maxGas < GasTracker.MAX_GAS ? maxGas : GasTracker.MAX_GAS;
    }

    public get timeSpent(): bigint {
        return 0n;
    }

    public static convertSatToGas(sat: bigint, maxGas: bigint, ratio: bigint): bigint {
        let gas = sat * ratio;
        return gas < maxGas ? gas : maxGas;
    }

    // round up to 10000000
    public static round(gasUsed: bigint) {
        return (
            ((gasUsed + (GasTracker.SAT_TO_GAS_RATIO - 1n)) / GasTracker.SAT_TO_GAS_RATIO) *
            GasTracker.SAT_TO_GAS_RATIO
        );
    }

    public isEnabled(): boolean {
        return this.canTrack;
    }

    public addGasUsed(gas: bigint) {
        if (!this.canTrack) {
            return;
        }

        if (gas < 0n) {
            throw new Error('Gas used cannot be negative.');
        }

        if (this.#gasUsed + gas > this.#maxGas) {
            throw new Error(`out of gas ${this.#gasUsed + gas} > ${this.#maxGas}`);
        }

        if (this.#gasUsed + gas > this.MAX_GAS) {
            throw new Error(`out of gas ${this.#gasUsed + gas} > ${this.MAX_GAS} (max)`);
        }

        this.#gasUsed += gas;
    }

    public reset(): void {
        this.#gasUsed = 0n;
        this.#maxGas = this.MAX_GAS;
    }

    public enableTracking(): void {
        this.canTrack = true;
    }

    public disableTracking(): void {
        this.canTrack = false;
    }
}
