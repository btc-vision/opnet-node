import { BitcoinNetwork } from '@btc-vision/bsi-common';
import { ChainIds } from '../../../config/enums/ChainIds.js';

export type TrustedNetworkPublicKeys = {
    [key in BitcoinNetwork]: string[];
};

export type TrustedPublicKeys = {
    [key in ChainIds]: Partial<TrustedNetworkPublicKeys>;
};
