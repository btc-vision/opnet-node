import { BitcoinAddress } from '../../bitcoin/types/BitcoinAddress.js';

export interface IBTC {
    readonly owner: BitcoinAddress;
    readonly address: BitcoinAddress;
}
