import { OPNetConsensus } from '../../poa/configurations/OPNetConsensus.js';

export class GasTracker {
    #gasUsed: bigint = 0n;
    #maxGas: bigint = 0n;

    constructor(maxGas: bigint) {
        this.setMaxGas(maxGas);
    }

    public get gasUsed(): bigint {
        return this.#gasUsed;
    }

    public get maxGas(): bigint {
        return this.#maxGas;
    }

    public static convertSatToGas(sat: bigint, maxGas: bigint, ratio: bigint): bigint {
        const gas = sat * ratio;
        return gas < maxGas ? gas : maxGas;
    }

    public setMaxGas(maxGas: bigint) {
        this.#maxGas =
            maxGas < OPNetConsensus.consensus.GAS.TRANSACTION_MAX_GAS
                ? maxGas
                : OPNetConsensus.consensus.GAS.TRANSACTION_MAX_GAS;
    }

    public setGasUsed(gas: bigint) {
        if (gas < 0n) {
            throw new Error('Gas used cannot be negative.');
        }

        if (gas > this.#maxGas) {
            throw new Error(`out of gas ${gas} > ${this.#maxGas}`);
        }

        this.#gasUsed = gas;
    }
}
