import {ABICoder, Address, Selector} from '@btc-vision/transaction';
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
        [key in BitcoinNetwork]: { address: Address };
    }>;
} = {
    [ChainIds.Bitcoin]: {
        [BitcoinNetwork.mainnet]: {
            address: Address.dead(),
        },
        [BitcoinNetwork.testnet]: {
            address: Address.dead(),
        },
        [BitcoinNetwork.regtest]: {
            address: Address.dead(),
        },
        [BitcoinNetwork.signet]: {
            address: Address.dead(),
        },
    },
    [ChainIds.Fractal]: {
        [BitcoinNetwork.mainnet]: {
            address: Address.dead(),
        },
        [BitcoinNetwork.testnet]: {
            address: Address.dead(),
        },
        [BitcoinNetwork.regtest]: {
            address: Address.dead(),
        },
        [BitcoinNetwork.signet]: {
            address: Address.dead(),
        },
    },
};
