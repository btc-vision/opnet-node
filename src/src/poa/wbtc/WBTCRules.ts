import { ABICoder, Selector } from '@btc-vision/transaction';
import { ChainIds } from '../../config/enums/ChainIds.js';

import { BitcoinNetwork } from '../../config/network/BitcoinNetwork.js';

export const WRAPPING_INVALID_AMOUNT_PENALTY: bigint = 10000n; // 10000 sat penalty for invalid amount (0.0001 BTC)

export const WRAPPING_INDEXER_PERCENTAGE_FEE_BASE: bigint = 10000n; // 0.1% fee of wrapped bitcoin goes to rewards.
export const WRAPPING_INDEXER_PERCENTAGE_FEE: bigint = 30n; // 0.3% fee of wrapped bitcoin goes to rewards.

export const WBTC_WRAP_SELECTOR: Selector = Number('0x' + new ABICoder().encodeSelector('mint'));
export const WBTC_UNWRAP_SELECTOR: Selector = Number('0x' + new ABICoder().encodeSelector('burn'));

export const WRAPPING_FEE_STACKING: bigint = 30n; // 35 % goes to stacking
export const OPNET_FEES: bigint = 10n; // 10 % goes to OPNET
export const WRAPPING_INDEXER_FEES: bigint = 100n - WRAPPING_FEE_STACKING - OPNET_FEES; // 55 % goes to indexer

export const OPNET_FEE_WALLET: {
    [key in ChainIds]: Partial<{
        [key in BitcoinNetwork]: { address: string };
    }>;
} = {
    [ChainIds.Bitcoin]: {
        [BitcoinNetwork.mainnet]: {
            address: 'bc1pjune3rz4zcm8scdv9hnu5cld8vh4eqrwagph9wsez0rutjxkvwls6mhr3l',
        },
        [BitcoinNetwork.testnet]: {
            address: 'tb1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gszlcezf',
        },
        [BitcoinNetwork.regtest]: {
            address: 'bcrt1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw52gs0xjlhn',
        },
        [BitcoinNetwork.signet]: {
            address: 'bc1pjune3rz4zcm8scdv9hnu5cld8vh4eqrwagph9wsez0rutjxkvwls6mhr3l',
        },
    },
    [ChainIds.Fractal]: {
        [BitcoinNetwork.mainnet]: {
            address: 'bc1p823gdnqvk8a90f8cu30w8ywvk29uh8txtqqnsmk6f5ktd7hlyl0qxsjd0h',
        },
        [BitcoinNetwork.testnet]: {
            address: 'bc1p823gdnqvk8a90f8cu30w8ywvk29uh8txtqqnsmk6f5ktd7hlyl0qxsjd0h',
        },
        [BitcoinNetwork.regtest]: {
            address: 'bc1p823gdnqvk8a90f8cu30w8ywvk29uh8txtqqnsmk6f5ktd7hlyl0qxsjd0h',
        },
        [BitcoinNetwork.signet]: {
            address: 'bc1p823gdnqvk8a90f8cu30w8ywvk29uh8txtqqnsmk6f5ktd7hlyl0qxsjd0h',
        },
    },
};
