import { ABICoder, Selector } from '@btc-vision/bsi-binary';

export const WRAPPING_INVALID_AMOUNT_PENALTY: bigint = 10000n; // 10000 sat penalty for invalid amount (0.0001 BTC)

export const WRAPPING_INDEXER_PERCENTAGE_FEE_BASE: bigint = 10000n; // 0.1% fee of wrapped bitcoin goes to rewards.
export const WRAPPING_INDEXER_PERCENTAGE_FEE: bigint = 30n; // 0.3% fee of wrapped bitcoin goes to rewards.

export const WBTC_WRAP_SELECTOR: Selector = Number('0x' + new ABICoder().encodeSelector('mint'));
export const WBTC_UNWRAP_SELECTOR: Selector = Number('0x' + new ABICoder().encodeSelector('burn'));
