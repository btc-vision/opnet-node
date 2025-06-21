import { Address } from '@btc-vision/transaction';
import { SpecialContract, SpecialContracts } from '../../types/SpecialContracts.js';

const nativeSwapRegtest: Address = Address.fromString(
    '0x05f81680bf5a131cc6384f3c2c16392353c2e227463b2913994b5f01d5443831',
);

const nativeSwapRegtest2: Address = Address.fromString(
    `0x2a207fb02a5938b463ae8f43d0dde11581e0ca520b206b6ba3eff4ca8245eca2`,
);

const nativeSwapTestnet: Address = Address.fromString(
    '0xeee1f46e105c62ece22ee947d6890501b98edc01f7118694ede235942e7d3c21',
);

const nativeSwapTestnet2: Address = Address.fromString(
    '0xe9d1826f360eef9c5d827e29ef8c64205d709d9e93f9315c3decc21331b57baf',
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

    [nativeSwapTestnet2.toHex()]: {
        ...nativeSwapContractSettings,

        address: nativeSwapTestnet2,
    },
};

export const SPECIAL_CONTRACTS_ROSWELL_MAINNET: SpecialContracts = {
    [nativeSwapMainnet.toHex()]: {
        ...nativeSwapContractSettings,

        address: nativeSwapMainnet,
    },
};
