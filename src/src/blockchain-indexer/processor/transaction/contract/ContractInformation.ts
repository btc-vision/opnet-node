import { Binary, Decimal128 } from 'mongodb';
import { BitcoinAddress } from '../../../../bitcoin/types/BitcoinAddress.js';
import { IContractDocument } from '../../../../db/documents/interfaces/IContractDocument.js';
import { DeploymentTransaction } from '../transactions/DeploymentTransaction.js';

export class ContractInformation {
    constructor(
        public readonly blockHeight: bigint,
        public readonly contractAddress: BitcoinAddress,
        public readonly virtualAddress: string,
        public readonly bytecode: Buffer,
        public readonly wasCompressed: boolean,
        public readonly deployedTransactionId: string,
        public readonly deployedTransactionHash: string,
        public readonly deployerPubKey: Buffer,
        public readonly contractSeed: Buffer,
        public readonly contractSaltHash: Buffer,
        public readonly burnedFee: bigint,
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
            this.fromDecimal128(contractDocument.blockHeight),
            contractDocument.contractAddress,
            contractDocument.virtualAddress,
            bytecodeBuffer,
            contractDocument.wasCompressed,
            contractDocument.deployedTransactionId,
            contractDocument.deployedTransactionHash,
            deployerPubKeyBuffer,
            contractSeedBuffer,
            contractSaltHashBuffer,
            this.fromDecimal128(contractDocument.burnedFee),
        );
    }

    public static fromTransaction(
        blockHeight: bigint,
        transaction: DeploymentTransaction,
    ): ContractInformation {
        if (!transaction.contractAddress) {
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
            transaction.contractAddress,
            transaction.virtualAddress,
            transaction.bytecode,
            transaction.wasCompressed,
            transaction.transactionId,
            transaction.hash,
            transaction.deployerPubKey,
            transaction.contractSeed,
            transaction.contractSaltHash,
            transaction.burnedFee,
        );
    }

    private static fromDecimal128(value: Decimal128): bigint {
        return BigInt(value.toString());
    }

    public toDocument(): IContractDocument {
        return {
            blockHeight: this.toDecimal128(this.blockHeight),
            contractAddress: this.contractAddress,
            virtualAddress: this.virtualAddress,
            bytecode: new Binary(this.bytecode),
            wasCompressed: this.wasCompressed,
            deployedTransactionId: this.deployedTransactionId,
            deployedTransactionHash: this.deployedTransactionHash,
            deployerPubKey: new Binary(this.deployerPubKey),
            contractSeed: new Binary(this.contractSeed),
            contractSaltHash: new Binary(this.contractSaltHash),
            burnedFee: this.toDecimal128(this.burnedFee),
        };
    }

    private toDecimal128(value: bigint): Decimal128 {
        return Decimal128.fromString(value.toString());
    }
}
