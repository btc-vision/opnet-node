import { DataConverter } from '@btc-vision/bsi-db';
import { Binary } from 'mongodb';
import { IContractDocument } from '../../../../db/documents/interfaces/IContractDocument.js';
import { DeploymentTransaction } from '../transactions/DeploymentTransaction.js';
import { Address } from '@btc-vision/bsi-binary';

export interface ContractInformationAsString {
    readonly blockHeight: string;
    readonly contractAddress: string;
    readonly virtualAddress: string;
    readonly p2trAddress: string | null;
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
        public readonly contractAddress: Address,
        public readonly virtualAddress: Address,
        public readonly p2trAddress: Address | null,
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
            contractDocument.virtualAddress,
            contractDocument.p2trAddress,
            bytecodeBuffer,
            contractDocument.wasCompressed,
            contractDocument.deployedTransactionId,
            contractDocument.deployedTransactionHash,
            deployerPubKeyBuffer,
            contractSeedBuffer,
            contractSaltHashBuffer,
            contractDocument.deployerAddress,
        );
    }

    public static fromTransaction(
        blockHeight: bigint,
        transaction: DeploymentTransaction,
    ): ContractInformation {
        if (!transaction.p2trAddress) {
            throw new Error('Contract address is missing');
        }

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
            transaction.segwitAddress,
            transaction.virtualAddress,
            transaction.p2trAddress,
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
            p2trAddress: this.p2trAddress,
            virtualAddress: this.virtualAddress,
            bytecode: new Binary(this.bytecode),
            wasCompressed: this.wasCompressed,
            deployedTransactionId: this.deployedTransactionId,
            deployedTransactionHash: this.deployedTransactionHash,
            deployerPubKey: new Binary(this.deployerPubKey),
            contractSeed: new Binary(this.contractSeed),
            contractSaltHash: new Binary(this.contractSaltHash),
            deployerAddress: this.deployerAddress,
        };
    }
}
