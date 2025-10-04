import { Address } from '@btc-vision/transaction';
import { SpecialContract, SpecialContracts } from '../../types/SpecialContracts.js';

const nativeSwapRegtest: Address = Address.fromString(
    '0x65a36498ef6d9aca78050e8bbcb0031f13cfa0b6b3fb9efbbd1f4be46bff1a47',
);

const nativeSwapRegtest2: Address = Address.fromString(
    '0x83e419238b88943514756b8b2aee42c7e1f1e8769a0eac4de53a01fc3c6efa03',
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

const native5: Address = Address.fromString(
    '0x351b561fb13276343446b11aa20b4c79c610f501630d3eb52c57f15c0fd975a4',
);

const native6: Address = Address.fromString(
    '0x5d1b0da6733a286fa66dbf0507d72c9fc35abcf39fe118fbbed2d5bb055c3f0e',
);

const native7: Address = Address.fromString(
    '0xb0c5f5529c0abe9bf3a7d249f7b2791bcbd60915e8dfc6485a12b89959a443af',
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

    [native5.toHex()]: {
        ...nativeSwapContractSettings,

        address: native5,
    },

    [native6.toHex()]: {
        ...nativeSwapContractSettings,

        address: native6,
    },

    [native7.toHex()]: {
        ...nativeSwapContractSettings,

        address: native7,
    },
};

export const SPECIAL_CONTRACTS_ROSWELL_MAINNET: SpecialContracts = {
    [nativeSwapMainnet.toHex()]: {
        ...nativeSwapContractSettings,

        address: nativeSwapMainnet,
    },
};
