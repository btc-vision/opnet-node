import { Address } from '@btc-vision/transaction';
import { SpecialContract, SpecialContracts } from '../../types/SpecialContracts.js';

const nativeSwapRegtest: Address = Address.fromString(
    '0x05f81680bf5a131cc6384f3c2c16392353c2e227463b2913994b5f01d5443831',
);

const nativeSwapRegtest2: Address = Address.fromString(
    `0x72e75043414b0f803c60ee81bf32f84658411900c9e36b66e9b7eb9ef2783efb`,
);

const nativeSwapTestnet: Address = Address.fromString(
    '0xeee1f46e105c62ece22ee947d6890501b98edc01f7118694ede235942e7d3c21',
);

const nativeSwapMainnet: Address = Address.dead();

const nativeSwapContractSettings: Omit<SpecialContract, 'address'> = {
    freeGas: true,
    bypassBlockLimit: true,

    maxExternalGas: 10_000_000_000n,
};

export const SPECIAL_CONTRACTS_ROSWELL_REGTEST: SpecialContracts = {
    [nativeSwapRegtest.toHex()]: {
        ...nativeSwapContractSettings,

        address: nativeSwapRegtest,
    },

    [nativeSwapRegtest2.toHex()]: {
        ...nativeSwapContractSettings,

        address: nativeSwapRegtest2,
    },
};

export const SPECIAL_CONTRACTS_ROSWELL_TESTNET: SpecialContracts = {
    [nativeSwapTestnet.toHex()]: {
        ...nativeSwapContractSettings,

        address: nativeSwapTestnet,
    },
};

export const SPECIAL_CONTRACTS_ROSWELL_MAINNET: SpecialContracts = {
    [nativeSwapMainnet.toHex()]: {
        ...nativeSwapContractSettings,

        address: nativeSwapMainnet,
    },
};
