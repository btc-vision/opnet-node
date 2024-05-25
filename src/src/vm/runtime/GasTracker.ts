export class GasTracker {
    #gasUsed: bigint = 0n;
    #maxGas: bigint;

    private canTrack: boolean = true;

    constructor(private readonly MAX_GAS: bigint) {
        this.#maxGas = MAX_GAS;
    }

    public get gasUsed(): bigint {
        return this.#gasUsed;
    }

    public set gasUsed(gas: bigint) {
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

    public set maxGas(maxGas: bigint) {
        this.#maxGas = maxGas;
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
