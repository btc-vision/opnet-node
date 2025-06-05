import { Address } from '@btc-vision/transaction';

export interface SpecialContract {
    readonly address: Address;

    /**
     * Even if the gas is free for this call, the total gas usage count towards the block gas.
     */
    readonly freeGas: boolean;

    /**
     * Bypass global block limit for this contract.
     */
    readonly bypassBlockLimit: boolean;

    /**
     * The maximum allowed gas usage by external calls to this contract.
     */
    readonly maxExternalGas: bigint;
}

export type SpecialContracts = {
    [key: string]: SpecialContract | undefined;
};
