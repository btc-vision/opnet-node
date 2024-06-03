import { BitcoinNetwork } from '@btc-vision/bsi-common';
import { ChainIds } from '../../../config/enums/ChainIds.js';
import { TrustedCompanies } from '../TrustedCompanies.js';

export type TrustedNetworkPublicKeys = {
    [key in BitcoinNetwork]: NetworkAuthorityConfiguration;
};

export type TrustedPublicKeys = {
    [key in ChainIds]: Partial<TrustedNetworkPublicKeys>;
};

export interface AuthorityKey {
    readonly opnet: string;
    readonly publicKey: string;
    readonly signature: string;
}

export interface AuthorityBufferKey {
    readonly opnet: Buffer;
    readonly publicKey: Buffer;
    readonly signature: Buffer;
}

export interface AuthorityKeys {
    readonly keys: AuthorityKey[];
}

export interface AuthorityKeysAsBytes {
    readonly keys: AuthorityBufferKey[];
}

export type ProvenAuthorityKeys = {
    [key in TrustedCompanies]: AuthorityKeys;
};

export interface NetworkAuthorityConfiguration {
    readonly minimum: number;
    readonly transactionMinimum: number;
    readonly maximumValidatorPerTrustedEntities: number;

    readonly trusted: Partial<ProvenAuthorityKeys>;
}

export type PrecomputedAuthorityKeys = {
    [key in TrustedCompanies]: {
        readonly keys: string[];
    };
};

export type ProvenAuthorityKeysAsBytes = {
    [key in TrustedCompanies]: AuthorityKeysAsBytes;
};
