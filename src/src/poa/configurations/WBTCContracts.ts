import { ChainIds } from '../../config/enums/ChainIds.js';
import { BitcoinNetwork } from '../../config/network/BitcoinNetwork.js';
import { Address, WBTC_ADDRESS_REGTEST } from '@btc-vision/transaction';
import { networks } from 'bitcoinjs-lib';

export const WBTC_CONTRACT_ADDRESS: {
    [key in ChainIds]: Partial<{
        [key in BitcoinNetwork]: { addresses: string[]; deployer: Address };
    }>;
} = {
    [ChainIds.Bitcoin]: {
        [BitcoinNetwork.mainnet]: {
            addresses: ['unknown'],
            deployer: Address.dead(),
        },

        [BitcoinNetwork.testnet]: {
            addresses: ['unknown'],
            deployer: Address.dead(),
        },

        [BitcoinNetwork.regtest]: {
            addresses: [WBTC_ADDRESS_REGTEST.p2tr(networks.regtest)],
            deployer: Address.dead(), //.fromString(''),
        },

        [BitcoinNetwork.signet]: {
            addresses: ['unknown'],
            deployer: Address.dead(),
        },
    },
    [ChainIds.Fractal]: {
        [BitcoinNetwork.mainnet]: {
            addresses: ['unknown'],
            deployer: Address.dead(),
        },

        [BitcoinNetwork.testnet]: {
            addresses: ['unknown'],
            deployer: Address.dead(),
        },

        [BitcoinNetwork.regtest]: {
            addresses: ['unknown'],
            deployer: Address.dead(),
        },

        [BitcoinNetwork.signet]: {
            addresses: ['unknown'],
            deployer: Address.dead(),
        },
    },
};
