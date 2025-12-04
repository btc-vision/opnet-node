import { Address } from '@btc-vision/transaction';
import { SpecialContract, SpecialContracts } from '../../types/SpecialContracts.js';

// APPLIED @ BLOCK 16706
const nativeSwapRegtest: Address = Address.fromString(
    '0x9c452bd5f9d0245c96fa8ce3a824b7986a6b5c3cafcf5b91090bc97a67cdc145',
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
    /*[nativeSwapRegtestRedeploy.toHex()]: {
        ...nativeSwapContractSettings,

        address: nativeSwapRegtestRedeploy,
    },*/
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
