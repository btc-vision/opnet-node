import { Address } from '@btc-vision/transaction';
import { SpecialContract, SpecialContracts } from '../../types/SpecialContracts.js';

// APPLIED @ BLOCK 16706
const nativeSwapRegtest: Address = Address.fromString(
    '0x9c452bd5f9d0245c96fa8ce3a824b7986a6b5c3cafcf5b91090bc97a67cdc145',
);

const nativeSwapRegtest2: Address = Address.fromString(
    '0xa608b995c38f13069efd901a8bd0b4ca5333036da68e97b95eee03d9552a32ca',
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
    [nativeSwapRegtest2.toHex()]: {
        ...nativeSwapContractSettings,

        address: nativeSwapRegtest2,
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
