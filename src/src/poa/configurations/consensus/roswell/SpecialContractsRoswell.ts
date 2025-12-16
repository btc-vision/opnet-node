import { Address } from '@btc-vision/transaction';
import { SpecialContract, SpecialContracts } from '../../types/SpecialContracts.js';

// APPLIED @ BLOCK 16706
const nativeSwapRegtest: Address = Address.fromString(
    '0xd7bf1ef160a5cc688682b16f36128cdba4710578541a5dc5fe9b2e88d975907a',
);

/*const nativeSwapTestnet: Address = Address.fromString(
    '',
);*/

// const nativeSwapMainnet: Address = Address.dead();

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
    /*[nativeSwapTestnet.toHex()]: {
        ...nativeSwapContractSettings,

        address: nativeSwapTestnet,
    }*/
};

export const SPECIAL_CONTRACTS_ROSWELL_MAINNET: SpecialContracts = {
    /* [nativeSwapMainnet.toHex()]: {
        ...nativeSwapContractSettings,

        address: nativeSwapMainnet,
    },*/
};
