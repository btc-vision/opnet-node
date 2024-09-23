import { ChainIds } from '../../config/enums/ChainIds.js';
import { BitcoinNetwork } from '../../config/network/BitcoinNetwork.js';

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
            addresses: ['bcrt1qdr7sjgtnudda8zrfklw8l5cnrxum5hns7e46hf'], //WBTC_ADDRESS_REGTEST bcrt1qdr7sjgtnudda8zrfklw8l5cnrxum5hns7e46hf
            deployer: 'bcrt1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gs0xjlhn', // 'bcrt1p823gdnqvk8a90f8cu30w8ywvk29uh8txtqqnsmk6f5ktd7hlyl0qupwyqz',
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
