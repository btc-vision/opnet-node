import { Address } from '@btc-vision/transaction';
import { SpecialContract, SpecialContracts } from '../../types/SpecialContracts.js';

const nativeSwapRegtest: Address = Address.fromString(
    '0x65a36498ef6d9aca78050e8bbcb0031f13cfa0b6b3fb9efbbd1f4be46bff1a47',
);

const nativeSwapTestnet: Address = Address.fromString(
    '0xb029ae75cff337453696c86af773b022b929b2666eec8b8693e8e745be65e305',
);

const nativeSecondaryTestnet: Address = Address.fromString(
    '0x656d8e262f18ae8ef6847b45b3919be32f2d78562a30a40fbcaaca6993fa5d23',
);

const nativeThirdTestnet: Address = Address.fromString(
    '0x1b06ae0d72bdd6639e5856f09d06fdfd0f0897f2af2e6ed60a740d1edd53ca9a',
);

const native4: Address = Address.fromString(
    '0x5183fa7bf25500bcbc7be165776e5ad3dc10840e7d861a97c9e93647fe6f8d8c',
);

const nativeSwapMainnet: Address = Address.dead();

const nativeSwapContractSettings: Omit<SpecialContract, 'address'> = {
    freeGas: true,
    bypassBlockLimit: true,

    maxExternalGas: 10_000_000_000n,
    transactionGasLimit: 600_000_000_000n,
};

export const SPECIAL_CONTRACTS_ROSWELL_REGTEST: SpecialContracts = {
    [nativeSwapRegtest.toHex()]: {
        ...nativeSwapContractSettings,

        address: nativeSwapRegtest,
    },
};

export const SPECIAL_CONTRACTS_ROSWELL_TESTNET: SpecialContracts = {
    [nativeSwapTestnet.toHex()]: {
        ...nativeSwapContractSettings,

        address: nativeSwapTestnet,
    },

    [nativeSecondaryTestnet.toHex()]: {
        ...nativeSwapContractSettings,

        address: nativeSecondaryTestnet,
    },

    [nativeThirdTestnet.toHex()]: {
        ...nativeSwapContractSettings,

        address: nativeThirdTestnet,
    },

    [native4.toHex()]: {
        ...nativeSwapContractSettings,

        address: native4,
    },
};

export const SPECIAL_CONTRACTS_ROSWELL_MAINNET: SpecialContracts = {
    [nativeSwapMainnet.toHex()]: {
        ...nativeSwapContractSettings,

        address: nativeSwapMainnet,
    },
};
