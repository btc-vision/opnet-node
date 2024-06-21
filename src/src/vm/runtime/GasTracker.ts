import { OPNetConsensus } from '../../poa/configurations/OPNetConsensus.js';

export class GasTracker {
    public static readonly MAX_GAS: bigint = 300_000_000_000n; // Max gas allowed for a contract execution

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
            ((gasUsed + (OPNetConsensus.consensus.TRANSACTIONS.SAT_TO_GAS_RATIO - 1n)) /
                OPNetConsensus.consensus.TRANSACTIONS.SAT_TO_GAS_RATIO) *
            OPNetConsensus.consensus.TRANSACTIONS.SAT_TO_GAS_RATIO
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
