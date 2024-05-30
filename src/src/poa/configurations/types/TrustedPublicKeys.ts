import { BitcoinNetwork } from '@btc-vision/bsi-common';
import { ChainIds } from '../../../config/enums/ChainIds.js';
import { TrustedCompanies } from '../TrustedCompanies.js';

export type TrustedNetworkPublicKeys = {
    [key in BitcoinNetwork]: Partial<ProvenAuthorityKeys>;
};

export type TrustedPublicKeys = {
    [key in ChainIds]: Partial<TrustedNetworkPublicKeys>;
};

export interface AuthorityKeys {
    readonly keys: string[];
}

export interface AuthorityKeysAsBytes {
    readonly keys: Buffer[];
}

export type ProvenAuthorityKeys = {
    [key in TrustedCompanies]: AuthorityKeys;
};

export type ProvenAuthorityKeysAsBytes = {
    [key in TrustedCompanies]: AuthorityKeysAsBytes;
};
