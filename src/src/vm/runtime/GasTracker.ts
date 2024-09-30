import { OPNetConsensus } from '../../poa/configurations/OPNetConsensus.js';

export class GasTracker {
    #gasUsed: bigint = 0n;
    #maxGas: bigint;

    #startedAt: number = Date.now();

    constructor(private readonly MAX_GAS: bigint) {
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
        this.#maxGas =
            maxGas < OPNetConsensus.consensus.GAS.TARGET_GAS
                ? maxGas
                : OPNetConsensus.consensus.GAS.TARGET_GAS;
    }

    public get timeSpent(): bigint {
        return BigInt(Date.now() - this.#startedAt);
    }

    public static convertSatToGas(sat: bigint, maxGas: bigint, ratio: bigint): bigint {
        const gas = sat * ratio;
        return gas < maxGas ? gas : maxGas;
    }

    // round up to 10000000
    public static round(gasUsed: bigint) {
        return (
            ((gasUsed + (OPNetConsensus.consensus.GAS.SAT_TO_GAS_RATIO - 1n)) /
                OPNetConsensus.consensus.GAS.SAT_TO_GAS_RATIO) *
            OPNetConsensus.consensus.GAS.SAT_TO_GAS_RATIO
        );
    }

    public setGas(gas: bigint) {
        if (gas < 0n) {
            throw new Error('Gas used cannot be negative.');
        }

        if (gas > this.#maxGas) {
            throw new Error(`out of gas ${gas} > ${this.#maxGas}`);
        }

        if (gas > this.MAX_GAS) {
            throw new Error(`out of gas ${gas} > ${this.MAX_GAS} (max)`);
        }

        this.#gasUsed = gas;
    }
}
