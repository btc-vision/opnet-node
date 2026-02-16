import { DataConverter } from '@btc-vision/bsi-common';
import { fromBase64 } from '@btc-vision/bitcoin';
import { Binary } from 'mongodb';
import { IContractDocument } from '../../../../db/documents/interfaces/IContractDocument.js';
import { DeploymentTransaction } from '../transactions/DeploymentTransaction.js';
import { Address } from '@btc-vision/transaction';

export interface ContractInformationAsString {
    readonly blockHeight: string;
    readonly contractAddress: string;
    readonly contractPublicKey: string;
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
        public readonly contractPublicKey: Address,
        public readonly bytecode: Uint8Array,
        public readonly wasCompressed: boolean,
        public readonly deployedTransactionId: Uint8Array,
        public readonly deployedTransactionHash: Uint8Array,
        public readonly deployerPubKey: Uint8Array,
        public readonly contractSeed: Uint8Array,
        public readonly contractSaltHash: Uint8Array,
        public readonly deployerAddress: Address,
    ) {}

    public static fromDocument(contractDocument: IContractDocument): ContractInformation {
        const bytecodeBytes = contractDocument.bytecode instanceof Uint8Array
            ? contractDocument.bytecode
            : new Uint8Array(contractDocument.bytecode.buffer);

        const deployerPubKeyBytes = contractDocument.deployerPubKey instanceof Uint8Array
            ? contractDocument.deployerPubKey
            : new Uint8Array(contractDocument.deployerPubKey.buffer);

        const contractSeedBytes = contractDocument.contractSeed instanceof Uint8Array
            ? contractDocument.contractSeed
            : new Uint8Array(contractDocument.contractSeed.buffer);

        const contractSaltHashBytes = contractDocument.contractSaltHash instanceof Uint8Array
            ? contractDocument.contractSaltHash
            : new Uint8Array(contractDocument.contractSaltHash.buffer);

        const transactionIdBytes = contractDocument.deployedTransactionId instanceof Uint8Array
            ? contractDocument.deployedTransactionId
            : new Uint8Array(contractDocument.deployedTransactionId.buffer);

        const deployedTransactionHashBytes = contractDocument.deployedTransactionHash instanceof Uint8Array
            ? contractDocument.deployedTransactionHash
            : new Uint8Array(contractDocument.deployedTransactionHash.buffer);

        return new ContractInformation(
            DataConverter.fromDecimal128(contractDocument.blockHeight),
            contractDocument.contractAddress,
            typeof contractDocument.contractPublicKey === 'string'
                ? new Address(fromBase64(contractDocument.contractPublicKey))
                : new Address(contractDocument.contractPublicKey.buffer),
            bytecodeBytes,
            contractDocument.wasCompressed,
            transactionIdBytes,
            deployedTransactionHashBytes,
            deployerPubKeyBytes,
            contractSeedBytes,
            contractSaltHashBytes,
            new Address(
                contractDocument.deployerAddress.buffer,
                contractDocument.deployerPubKey.buffer,
            ),
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
            contractPublicKey: new Binary(this.contractPublicKey),
            bytecode: new Binary(this.bytecode),
            wasCompressed: this.wasCompressed,
            deployedTransactionId: new Binary(this.deployedTransactionId),
            deployedTransactionHash: new Binary(this.deployedTransactionHash),
            deployerPubKey: new Binary(this.deployerPubKey),
            contractSeed: new Binary(this.contractSeed),
            contractSaltHash: new Binary(this.contractSaltHash),
            deployerAddress: new Binary(this.deployerAddress),
        };
    }
}
