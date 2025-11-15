import { Address } from '@btc-vision/transaction';
import { SpecialContract, SpecialContracts } from '../../types/SpecialContracts.js';

// APPLIED @ BLOCK 16706
const nativeSwapRegtest: Address = Address.fromString(
    '0x32d5c3490be026cda337526b72bc13036d278400ce823e29a00cb5aef15b5d53',
);

// 0x483363dcadfa49ad0a3ae7841c3ebc3b38bf9b73478987ae092191af87b9cdb7
const nativeSwapRegtestRedeploy: Address = Address.fromString(
    '0x483363dcadfa49ad0a3ae7841c3ebc3b38bf9b73478987ae092191af87b9cdb7',
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
    [nativeSwapRegtestRedeploy.toHex()]: {
        ...nativeSwapContractSettings,

        address: nativeSwapRegtestRedeploy,
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
