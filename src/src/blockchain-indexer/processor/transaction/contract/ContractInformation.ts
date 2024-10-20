import { DataConverter } from '@btc-vision/bsi-db';
import { Binary } from 'mongodb';
import { IContractDocument } from '../../../../db/documents/interfaces/IContractDocument.js';
import { DeploymentTransaction } from '../transactions/DeploymentTransaction.js';
import { Address } from '@btc-vision/transaction';

export interface ContractInformationAsString {
    readonly blockHeight: string;
    readonly contractAddress: string;
    readonly tweakedPublicKey: string;
    readonly bytecode: string;
    readonly wasCompressed: boolean;
    readonly deployedTransactionId: string;
    readonly deployedTransactionHash: string;
    readonly deployerPubKey: string;
    readonly contractSeed: string;
    readonly contractSaltHash: string;
    readonly deployerAddress: string;
}

export class ContractInformation {
    constructor(
        public readonly blockHeight: bigint,
        public readonly contractAddress: string,
        public readonly tweakedPublicKey: Address,
        public readonly bytecode: Buffer,
        public readonly wasCompressed: boolean,
        public readonly deployedTransactionId: string,
        public readonly deployedTransactionHash: string,
        public readonly deployerPubKey: Buffer,
        public readonly contractSeed: Buffer,
        public readonly contractSaltHash: Buffer,
        public readonly deployerAddress: Address,
    ) {}

    public static fromDocument(contractDocument: IContractDocument): ContractInformation {
        let bytecodeBuffer: Buffer;
        if (Buffer.isBuffer(contractDocument.bytecode)) {
            bytecodeBuffer = contractDocument.bytecode;
        } else {
            bytecodeBuffer = Buffer.from(contractDocument.bytecode.buffer);
        }

        let deployerPubKeyBuffer: Buffer;
        if (Buffer.isBuffer(contractDocument.deployerPubKey)) {
            deployerPubKeyBuffer = contractDocument.deployerPubKey;
        } else {
            deployerPubKeyBuffer = Buffer.from(contractDocument.deployerPubKey.buffer);
        }

        let contractSeedBuffer: Buffer;
        if (Buffer.isBuffer(contractDocument.contractSeed)) {
            contractSeedBuffer = contractDocument.contractSeed;
        } else {
            contractSeedBuffer = Buffer.from(contractDocument.contractSeed.buffer);
        }

        let contractSaltHashBuffer: Buffer;
        if (Buffer.isBuffer(contractDocument.contractSaltHash)) {
            contractSaltHashBuffer = contractDocument.contractSaltHash;
        } else {
            contractSaltHashBuffer = Buffer.from(contractDocument.contractSaltHash.buffer);
        }

        return new ContractInformation(
            DataConverter.fromDecimal128(contractDocument.blockHeight),
            contractDocument.contractAddress,
            typeof contractDocument.tweakedPublicKey === 'string'
                ? new Address(Buffer.from(contractDocument.tweakedPublicKey, 'base64'))
                : new Address(contractDocument.tweakedPublicKey.buffer),
            bytecodeBuffer,
            contractDocument.wasCompressed,
            contractDocument.deployedTransactionId,
            contractDocument.deployedTransactionHash,
            deployerPubKeyBuffer,
            contractSeedBuffer,
            contractSaltHashBuffer,
            new Address(contractDocument.deployerPubKey.buffer),
        );
    }

    public static fromTransaction(
        blockHeight: bigint,
        transaction: DeploymentTransaction,
    ): ContractInformation {
        if (!transaction.bytecode) {
            throw new Error('Contract bytecode is missing');
        }

        if (!transaction.deployerPubKey) {
            throw new Error('Contract deployer public key is missing');
        }

        if (!transaction.contractSeed) {
            throw new Error('Contract seed is missing');
        }

        if (!transaction.contractSaltHash) {
            throw new Error('Contract salt hash is missing');
        }

        return new ContractInformation(
            blockHeight,
            transaction.contractAddress,
            transaction.address,
            transaction.bytecode,
            transaction.wasCompressed,
            transaction.transactionId,
            transaction.hash,
            transaction.deployerPubKey,
            transaction.contractSeed,
            transaction.contractSaltHash,
            transaction.from,
        );
    }

    public toDocument(): IContractDocument {
        return {
            blockHeight: DataConverter.toDecimal128(this.blockHeight),
            contractAddress: this.contractAddress,
            tweakedPublicKey: new Binary(this.tweakedPublicKey),
            bytecode: new Binary(this.bytecode),
            wasCompressed: this.wasCompressed,
            deployedTransactionId: this.deployedTransactionId,
            deployedTransactionHash: this.deployedTransactionHash,
            deployerPubKey: new Binary(this.deployerPubKey),
            contractSeed: new Binary(this.contractSeed),
            contractSaltHash: new Binary(this.contractSaltHash),
        };
    }
}
