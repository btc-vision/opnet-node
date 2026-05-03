import { Address } from '@btc-vision/transaction';
import { SpecialContract, SpecialContracts } from '../../types/SpecialContracts.js';

// APPLIED @ BLOCK 16706
const nativeSwapRegtest: Address = Address.fromString(
    '0xfcab8f4f47c83846581eb2c1b07918971af2100d245444d9c3dee1a3dadd6d4f',
);

export const nativeSwapMainnet: Address = Address.fromString(
    '0xbaf131d22120efe459586eb9eda2590f78044851bfcda49365ed1c1dbc863ee4',
);

const nativeSwapTestnet: Address = Address.fromString(
    '0x4397befe4e067390596b3c296e77fe86589487bf3bf3f0a9a93ce794e2d78fb5',
);

const nativeSwapContractSettings: Omit<SpecialContract, 'address'> = {
    freeGas: true,
    bypassBlockLimit: true,

    maxExternalGas: 12_000_000_000n,
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
};

export const SPECIAL_CONTRACTS_ROSWELL_TESTNET4: SpecialContracts = {};

export const SPECIAL_CONTRACTS_ROSWELL_MAINNET: SpecialContracts = {
    [nativeSwapMainnet.toHex()]: {
        ...nativeSwapContractSettings,

        address: nativeSwapMainnet,
    },
};
