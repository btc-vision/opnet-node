import { Binary, Decimal128 } from 'mongodb';
import { TrustedCompanies } from '../../poa/configurations/TrustedCompanies.js';
import { VaultInput } from '../../blockchain-indexer/processor/vault/VaultInputDecoder.js';

export interface PublicAuthorityKeyDocument {
    key: Binary;
    authority: TrustedCompanies;
}

export interface VaultInputDocument {
    readonly transaction: string;
    readonly keys: PublicAuthorityKeyDocument[];
    readonly index: number;
}

export interface CompromisedTransactionDocument {
    readonly height: Decimal128;
    readonly id: string;

    readonly compromisedAuthorities: VaultInputDocument[];
}

export interface ICompromisedTransactionDocument
    extends Omit<CompromisedTransactionDocument, 'compromisedAuthorities' | 'height'> {
    readonly height: bigint;

    readonly compromisedAuthorities: VaultInput[];
}
