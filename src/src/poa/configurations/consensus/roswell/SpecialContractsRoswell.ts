import { Address } from '@btc-vision/transaction';
import { SpecialContract, SpecialContracts } from '../../types/SpecialContracts.js';

const nativeSwapRegtest: Address = Address.fromString(
    '0x65a36498ef6d9aca78050e8bbcb0031f13cfa0b6b3fb9efbbd1f4be46bff1a47',
);

const nativeSwapTestnet: Address = Address.fromString(
    '0xb029ae75cff337453696c86af773b022b929b2666eec8b8693e8e745be65e305',
);

const nativeSecondaryTestnet: Address = Address.fromString(
    '0x158ea7e5f16cd5b7cc5a410378944b7f0fb5e8f7312e5dba31cfa86e5c08fd28',
);

const nativeThirdTestnet: Address = Address.fromString(
    '0xcfbe271de8b9ce5e29096fac9e9d1e3ca65806c091e71f96dba1f7a0c9a4ad24',
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
};

export const SPECIAL_CONTRACTS_ROSWELL_MAINNET: SpecialContracts = {
    [nativeSwapMainnet.toHex()]: {
        ...nativeSwapContractSettings,

        address: nativeSwapMainnet,
    },
};
