import { BitcoinNetwork } from '@btc-vision/bsi-common';
import { ChainIds } from '../../../config/enums/ChainIds.js';
import { TrustedCompanies } from '../TrustedCompanies.js';
import { Address } from '@btc-vision/bsi-binary';

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
    readonly wallet: Address;
}

export interface AuthorityBufferKey {
    readonly opnet: Buffer;
    readonly publicKey: Buffer;
    readonly signature: Buffer;
    readonly wallet: Address;
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
    /** Minimum different trusted validators */
    readonly minimum: number;

    /** Minimum different trusted validator in a new generated transaction */
    readonly transactionMinimum: number;

    /** Minimum different entities in a transaction */
    readonly minimumValidatorTransactionGeneration: number;

    /** Maximum trusted validator per entity in a transaction */
    readonly maximumValidatorPerTrustedEntities: number;

    /** Trusted entities */
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
