import { IBaseDocument } from '@btc-vision/bsi-common';
import { Binary, Decimal128 } from 'mongodb';
import { BitcoinAddress } from '../../../bitcoin/types/BitcoinAddress.js';

export interface IContractDocument extends IBaseDocument {
    readonly blockHeight: Decimal128;
    readonly contractAddress: BitcoinAddress;
    readonly virtualAddress: string;
    readonly bytecode: Binary;
    readonly wasCompressed: boolean;
    readonly deployedTransactionId: string;
    readonly deployedTransactionHash: string;
    readonly deployerPubKey: Binary;
    readonly contractSeed: Binary;
    readonly contractSaltHash: Binary;
    readonly deployerAddress: BitcoinAddress;
}
