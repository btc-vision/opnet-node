import { Address } from '@btc-vision/transaction';

export const ZERO_HASH: string =
    '0x0000000000000000000000000000000000000000000000000000000000000000';

export const MAX_HASH: string =
    '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
export const MAX_MINUS_ONE: string =
    '0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe';

export const BTC_FAKE_ADDRESS: Address = Address.dead();
