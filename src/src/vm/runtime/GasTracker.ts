import { OPNetConsensus } from '../../poc/configurations/OPNetConsensus.js';
import { Address } from '@btc-vision/transaction';
import { SpecialContract } from '../../poc/configurations/types/SpecialContracts.js';

export class GasTracker {
    #gasUsed: bigint = 0n;
    #maxGas: bigint = 0n;

    #specialGas: bigint = 0n;
    #paidMaximum: bigint = 0n;

    constructor(
        maxGas: bigint,
        private readonly settings: SpecialContract | undefined,
    ) {
        if (this.settings && this.settings.freeGas) {
            this.#maxGas = this.cap(maxGas, this.settings.maxExternalGas);
            this.#paidMaximum = this.cap(
                maxGas,
                this.settings.transactionGasLimit
                    ? this.settings.transactionGasLimit
                    : OPNetConsensus.consensus.GAS.TRANSACTION_MAX_GAS,
            );
        } else {
            this.#maxGas = this.cap(maxGas, OPNetConsensus.consensus.GAS.TRANSACTION_MAX_GAS);
            this.#paidMaximum = this.#maxGas;
        }
    }

    public get paidMaximum(): bigint {
        return this.max(this.#paidMaximum, this.specialGasUsed + this.gasUsed);
    }

    public get maxGas(): bigint {
        return this.#maxGas;
    }

    public get specialGasUsed(): bigint {
        return this.#specialGas;
    }

    public get gasUsed(): bigint {
        return this.#gasUsed;
    }

    public static convertSatToGas(sat: bigint, maxGas: bigint, ratio: bigint): bigint {
        const gas = sat * ratio;
        return gas < maxGas ? gas : maxGas;
    }

    public combinedGas(external: boolean): bigint {
        if (external) {
            return this.#gasUsed;
        }

        return this.#gasUsed + this.#specialGas;
    }

    public maxGasVM(external: boolean): bigint {
        if (this.settings) {
            if (external && this.settings.freeGas) {
                return this.settings.maxExternalGas;
            }

            const gasCap = this.settings.transactionGasLimit
                ? this.settings.transactionGasLimit
                : OPNetConsensus.consensus.GAS.TRANSACTION_MAX_GAS;

            return gasCap - this.settings.maxExternalGas;
        }

        return this.#maxGas;
    }

    public setFinalGasUsed(gas: bigint, specialGas: bigint): void {
        if (gas < 0n) {
            throw new Error('Gas used cannot be negative.');
        }

        if (specialGas < 0n) {
            throw new Error('Special gas used cannot be negative.');
        }

        this.#gasUsed = gas;
        this.#specialGas = specialGas;
    }

    public setGasUsed(
        gas: bigint,
        specialGas: bigint,
        isExternCall: boolean,
        from?: Address,
    ): void {
        if (gas < 0n) {
            throw new Error('Gas used cannot be negative.');
        }

        const maxGas = this.maxGasVM(isExternCall);
        if (
            !isExternCall &&
            this.settings &&
            this.settings.freeGas &&
            from &&
            from.equals(this.settings.address)
        ) {
            const newGas = gas + specialGas;
            if (newGas > maxGas) {
                throw new Error(`out of gas ${newGas} > ${maxGas} (free gas)`);
            }

            // If the gas is free, we don't check it, but we do count it for the block gas.
            this.#specialGas = newGas;

            return;
        }

        if (specialGas) {
            throw new Error('Special gas should be 0 when setting gas used.');
        }

        return this.countGas(gas, maxGas);
    }

    private max(a: bigint, b: bigint): bigint {
        return a > b ? a : b;
    }

    private cap(maxGas: bigint, cap: bigint): bigint {
        return maxGas < cap ? maxGas : cap;
    }

    private countGas(gas: bigint, maxGas: bigint): void {
        if (gas > maxGas) {
            throw new Error(`out of gas ${gas} > ${maxGas}`);
        }

        this.#gasUsed = gas;
    }
}
