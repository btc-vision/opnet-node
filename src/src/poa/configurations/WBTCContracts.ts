import { ChainIds } from '../../config/enums/ChainIds.js';
import { BitcoinNetwork } from '../../config/network/BitcoinNetwork.js';
import { WBTC_ADDRESS_REGTEST } from '@btc-vision/transaction';

export const WBTC_CONTRACT_ADDRESS: {
    [key in ChainIds]: Partial<{
        [key in BitcoinNetwork]: { addresses: string[]; deployer: string };
    }>;
} = {
    [ChainIds.Bitcoin]: {
        [BitcoinNetwork.mainnet]: {
            addresses: ['unknown'],
            deployer: 'unknown',
        },

        [BitcoinNetwork.testnet]: {
            addresses: ['tb1qp28xna6pv47x6wflcplhu0a9hkld5shtvjx6xv'],
            deployer: 'tb1p5gsptxjfx4slghcw444umy6pzspy6yfq5cv95mu26rpcpgtduzds8y5h90',
        },

        [BitcoinNetwork.regtest]: {
            addresses: [WBTC_ADDRESS_REGTEST],
            deployer: 'bcrt1p823gdnqvk8a90f8cu30w8ywvk29uh8txtqqnsmk6f5ktd7hlyl0qupwyqz', //'bcrt1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gs0xjlhn',
        },

        [BitcoinNetwork.signet]: {
            addresses: ['unknown'],
            deployer: 'unknown',
        },
    },
    [ChainIds.Fractal]: {
        [BitcoinNetwork.mainnet]: {
            addresses: ['bc1qdtzlucslvrvu4useyh9r69supqrw3w4xn9t4yv'],
            deployer: 'bc1p823gdnqvk8a90f8cu30w8ywvk29uh8txtqqnsmk6f5ktd7hlyl0qxsjd0h',
        },

        [BitcoinNetwork.testnet]: {
            addresses: ['unknown'],
            deployer: 'unknown',
        },

        [BitcoinNetwork.regtest]: {
            addresses: ['unknown'],
            deployer: 'unknown',
        },

        [BitcoinNetwork.signet]: {
            addresses: ['unknown'],
            deployer: 'unknown',
        },
    },
};
