import { Binary, Decimal128 } from 'mongodb';
import { Address } from '@btc-vision/bsi-binary';

export interface IContractDocumentBase {
    readonly blockHeight: Decimal128 | string | undefined;
    readonly contractAddress: Address;
    readonly virtualAddress: Address;
    readonly p2trAddress: Address | null;
    readonly bytecode: Binary | string;
    readonly wasCompressed: boolean;
    readonly deployedTransactionId: string;
    readonly deployedTransactionHash: string;
    readonly deployerPubKey: Binary | string;
    readonly contractSeed: Binary | string;
    readonly contractSaltHash: Binary | string;
    readonly deployerAddress: Address;
}

export interface IContractAPIDocument extends IContractDocumentBase {
    readonly bytecode: string;
    readonly deployerPubKey: string;
    readonly contractSeed: string;
    readonly contractSaltHash: string;
    _id: undefined;
    blockHeight: undefined;
}

export interface IContractDocument extends IContractDocumentBase {
    readonly blockHeight: Decimal128;
    readonly bytecode: Binary;
    readonly deployerPubKey: Binary;
    readonly contractSeed: Binary;
    readonly contractSaltHash: Binary;
}
