import { ChainIds } from '../../../config/enums/ChainIds.js';
import { TrustedEntities } from '../TrustedEntities.js';

import { BitcoinNetwork } from '../../../config/network/BitcoinNetwork.js';
import { Address } from '@btc-vision/transaction';

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
    readonly walletPubKey: string;
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
    [key in TrustedEntities]: AuthorityKeys;
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
    [key in TrustedEntities]: {
        readonly keys: string[];
    };
};

export type ProvenAuthorityKeysAsBytes = {
    [key in TrustedEntities]: AuthorityKeysAsBytes;
};
