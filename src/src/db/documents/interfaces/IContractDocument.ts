import { Binary, Decimal128 } from 'mongodb';

export interface IContractDocumentBase {
    readonly blockHeight: Decimal128 | string | undefined;
    readonly contractAddress: string;
    readonly contractTweakedPublicKey: Binary | string;
    readonly contractHybridPublicKey: Binary | string;
    readonly bytecode: Binary | string;
    readonly wasCompressed: boolean;
    readonly deployedTransactionId: Binary | string;
    readonly deployedTransactionHash: Binary | string;
    readonly deployerPubKey: Binary | string;
    readonly contractSeed: Binary | string;
    readonly contractSaltHash: Binary | string;
}

export interface IContractAPIDocument
    extends Omit<IContractDocumentBase, 'deployerAddress' | 'deployerPubKey' | 'blockHeight'> {
    readonly bytecode: string;
    readonly deployerPubKey: string;
    readonly contractSeed: string;
    readonly contractSaltHash: string;
    readonly deployedTransactionId: string;
    readonly deployedTransactionHash: string;
    readonly deployerAddress: string;
}

export interface IContractDocument extends IContractDocumentBase {
    readonly blockHeight: Decimal128;
    readonly bytecode: Binary;
    readonly deployerPubKey: Binary;
    readonly contractSeed: Binary;
    readonly contractSaltHash: Binary;
    readonly deployedTransactionId: Binary;
    readonly deployedTransactionHash: Binary;
}
