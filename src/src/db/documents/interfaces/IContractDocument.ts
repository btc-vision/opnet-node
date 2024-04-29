import { Binary, Decimal128 } from 'mongodb';
import { BitcoinAddress } from '../../../bitcoin/types/BitcoinAddress.js';

export interface IContractDocumentBase {
    readonly blockHeight: Decimal128 | string | undefined;
    readonly contractAddress: BitcoinAddress;
    readonly virtualAddress: string;
    readonly bytecode: Binary | string;
    readonly wasCompressed: boolean;
    readonly deployedTransactionId: string;
    readonly deployedTransactionHash: string;
    readonly deployerPubKey: Binary | string;
    readonly contractSeed: Binary | string;
    readonly contractSaltHash: Binary | string;
    readonly deployerAddress: BitcoinAddress;
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
