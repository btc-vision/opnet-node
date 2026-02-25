import { Address } from '@btc-vision/transaction';
import { SpecialContract, SpecialContracts } from '../../types/SpecialContracts.js';

// APPLIED @ BLOCK 16706
const nativeSwapRegtest: Address = Address.fromString(
    '0xd7bf1ef160a5cc688682b16f36128cdba4710578541a5dc5fe9b2e88d975907a',
);

const nativeSwapRegtest2: Address = Address.fromString(
    '0xb056ba05448cf4a5468b3e1190b0928443981a93c3aff568467f101e94302422',
);

const nativeSwapMainnet: Address = Address.fromString(
    '0x035884f9ac2b6ae75d7778553e7d447899e9a82e247d7ced48f22aa102681e70',
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

export const SPECIAL_CONTRACTS_ROSWELL_TESTNET4: SpecialContracts = {};

export const SPECIAL_CONTRACTS_ROSWELL_MAINNET: SpecialContracts = {
    [nativeSwapMainnet.toHex()]: {
        ...nativeSwapContractSettings,

        address: nativeSwapMainnet,
    },
};
