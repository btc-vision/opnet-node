import { TransactionData, VIn, VOut } from '@btc-vision/bsi-bitcoin-rpc';
import bitcoin, { opcodes } from 'bitcoinjs-lib';
import { ECPairInterface } from 'ecpair';
import { DeploymentTransactionDocument } from '../../../../db/interfaces/ITransactionDocument.js';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { TransactionInput } from '../inputs/TransactionInput.js';
import { TransactionOutput } from '../inputs/TransactionOutput.js';
import { TransactionInformation } from '../PossibleOpNetTransactions.js';
import { Transaction } from '../Transaction.js';

import {
    Address,
    ContractAddressVerificationParams,
    EcKeyPair,
    TapscriptVerificator,
} from '@btc-vision/transaction';
import { DataConverter } from '@btc-vision/bsi-db';
import { Binary } from 'mongodb';
import { EvaluatedEvents, EvaluatedResult } from '../../../../vm/evaluated/EvaluatedResult.js';
import { OPNetConsensus } from '../../../../poa/configurations/OPNetConsensus.js';

interface DeploymentWitnessData {
    readonly rawPubKey: Buffer;

    deployerPubKey: Buffer;
    deployerPubKeyHash: Buffer;

    contractSaltPubKey: Buffer;
    contractSaltHash: Buffer;

    readonly bytecode: Buffer;
    readonly calldata?: Buffer;
}

export class DeploymentTransaction extends Transaction<OPNetTransactionTypes.Deployment> {
    public static LEGACY_DEPLOYMENT_SCRIPT: Buffer = Buffer.from([
        opcodes.OP_TOALTSTACK,

        opcodes.OP_CHECKSIGVERIFY,
        opcodes.OP_CHECKSIGVERIFY,

        opcodes.OP_HASH160,
        opcodes.OP_EQUALVERIFY,

        opcodes.OP_HASH256,
        opcodes.OP_EQUALVERIFY,

        opcodes.OP_DEPTH,
        opcodes.OP_1,
        opcodes.OP_NUMEQUAL,
        opcodes.OP_IF,

        opcodes.OP_0, // calldata flag
        opcodes.OP_1NEGATE,

        opcodes.OP_ELSE,
        opcodes.OP_1,
        opcodes.OP_ENDIF,
    ]);

    public readonly transactionType: OPNetTransactionTypes.Deployment =
        DeploymentTransaction.getType();

    public bytecode: Buffer | undefined;

    public contractSaltHash: Buffer | undefined;
    public contractSeed: Buffer | undefined;

    public deployerPubKey: Buffer | undefined;
    public deployerPubKeyHash: Buffer | undefined;

    public contractSigner: ECPairInterface | undefined;

    protected contractTweakedPublicKey: Buffer | undefined;

    public constructor(
        rawTransactionData: TransactionData,
        vInputIndex: number,
        blockHash: string,
        blockHeight: bigint,
        network: bitcoin.networks.Network,
    ) {
        super(rawTransactionData, vInputIndex, blockHash, blockHeight, network);
    }

    protected _contractAddress: Address | undefined;

    public get contractAddress(): string {
        if (!this._contractAddress) throw new Error('Contract address not found');
        return this._contractAddress.p2tr(this.network);
    }

    public get address(): Address {
        if (!this._contractAddress) throw new Error('Contract address not found');
        return this._contractAddress;
    }

    protected _calldata: Buffer | undefined;

    public get calldata(): Buffer {
        const calldata = Buffer.alloc(this._calldata?.length || 0);

        if (this._calldata) {
            this._calldata.copy(calldata);
        }

        return calldata;
    }

    public get tweakedPublicKey(): string {
        if (!this.contractTweakedPublicKey) {
            throw new Error('Contract virtual address not found');
        }

        return '0x' + this.contractTweakedPublicKey.toString('hex');
    }

    public static is(data: TransactionData): TransactionInformation | undefined {
        const vIndex = this._is(data, this.LEGACY_DEPLOYMENT_SCRIPT);
        if (vIndex === -1) {
            return;
        }

        return {
            type: this.getType(),
            vInIndex: vIndex,
        };
    }

    private static getType(): OPNetTransactionTypes.Deployment {
        return OPNetTransactionTypes.Deployment;
    }

    public toDocument(): DeploymentTransactionDocument {
        const receiptData: EvaluatedResult | undefined = this.receipt;
        const events: EvaluatedEvents | undefined = receiptData?.events;
        const receipt: Uint8Array | undefined = receiptData?.result;
        const receiptProofs: string[] = this.receiptProofs || [];

        if (receipt && receiptProofs.length === 0) {
            throw new Error(`No receipt proofs found for transaction ${this.txid}`);
        }

        if (!this._contractAddress) {
            throw new Error(`No contract address found for transaction`);
        }

        return {
            ...super.toDocument(),
            from: this.from,
            contractAddress: this.contractAddress,
            tweakedPublicKey: this._contractAddress,

            receiptProofs: receiptProofs,

            gasUsed: DataConverter.toDecimal128(this.gasUsed),

            receipt: receipt ? new Binary(receipt) : undefined,
            events: this.convertEvents(events),
        };
    }

    public parseTransaction(vIn: VIn[], vOuts: VOut[]): void {
        super.parseTransaction(vIn, vOuts);

        const inputOPNetWitnessTransactions = this.getInputWitnessTransactions();
        if (inputOPNetWitnessTransactions.length === 0) {
            throw new Error(
                `No input witness transactions found for deployment transaction ${this.txid}`,
            );
        }

        if (inputOPNetWitnessTransactions.length > 1) {
            throw new Error(
                `Can not deploy multiple contracts at the same time. Transaction ${this.txid} has ${inputOPNetWitnessTransactions.length} input witness transactions.`,
            );
        }

        /** Contract should ALWAYS have ONLY ONE input witness transaction */
        const scriptData = this.getWitnessWithMagic();
        if (!scriptData) {
            throw new Error(`No script data found for deployment transaction ${this.txid}`);
        }

        const deploymentWitnessData = this.getDeploymentWitnessData(scriptData);
        if (!deploymentWitnessData) {
            throw new Error(
                `No deployment witness data found for deployment transaction ${this.txid}`,
            );
        }

        this.bytecode = deploymentWitnessData.bytecode;
        this._calldata = deploymentWitnessData.calldata;

        const inputOPNetWitnessTransaction: TransactionInput = inputOPNetWitnessTransactions[0];
        const witnesses: string[] = inputOPNetWitnessTransaction.transactionInWitness;
        const originalSalt = Buffer.from(witnesses[0], 'hex');
        const deployerPubKey = Buffer.from(witnesses[1], 'hex');

        // Regenerate raw public key
        const rawPubKey = Buffer.alloc(deployerPubKey.length + 1);
        rawPubKey.writeUInt8(deploymentWitnessData.rawPubKey.readUInt8(0), 0);

        // copy data of deployerPubKey to rawPubKey
        deployerPubKey.copy(rawPubKey, 1);

        /** Verify witness data */
        const hashDeployerPubKey = bitcoin.crypto.hash160(deployerPubKey);
        if (!hashDeployerPubKey.equals(deploymentWitnessData.deployerPubKeyHash)) {
            throw new Error(
                `Invalid deployer public key hash found in deployment transaction. Expected ${deploymentWitnessData.deployerPubKeyHash.toString(
                    'hex',
                )} but got ${hashDeployerPubKey.toString('hex')}`,
            );
        }

        if (!deployerPubKey.equals(deploymentWitnessData.deployerPubKey)) {
            throw new Error(
                `Invalid deployer public key found in deployment transaction. Expected ${deploymentWitnessData.deployerPubKey.toString(
                    'hex',
                )} but got ${deployerPubKey.toString('hex')}`,
            );
        }

        this.deployerPubKeyHash = hashDeployerPubKey;
        this.deployerPubKey = rawPubKey;
        this.contractSeed = originalSalt;

        /** Verify contract salt */
        const hashOriginalSalt: Buffer = bitcoin.crypto.hash256(originalSalt);
        if (!hashOriginalSalt.equals(deploymentWitnessData.contractSaltHash)) {
            throw new Error(
                `Invalid contract salt hash found in deployment transaction. Expected ${deploymentWitnessData.contractSaltHash.toString(
                    'hex',
                )} but got ${hashOriginalSalt.toString('hex')}`,
            );
        }

        this.contractSaltHash = hashOriginalSalt;

        /** Restore contract seed/address */
        this.contractTweakedPublicKey = TapscriptVerificator.getContractSeed(
            deployerPubKey,
            this.bytecode,
            hashOriginalSalt,
        );

        /** Generate contract segwit address */
        this._contractAddress = new Address(this.contractTweakedPublicKey);

        this.contractSigner = EcKeyPair.fromSeedKeyPair(
            this.contractTweakedPublicKey,
            this.network,
        );

        /** TODO: Verify signatures, OPTIONAL, bitcoin-core job is supposed to handle that already. */

        /** We must verify the contract address */
        const inputTxId = this.inputs[this.vInputIndex].originalTransactionId;
        if (!inputTxId) {
            throw new Error(
                `No input transaction id found for deployment transaction ${this.txid}`,
            );
        }

        /** We regenerate the contract address and verify it */
        const input0: TransactionInput = this.inputs[0];
        const controlBlock = input0.transactionInWitness[input0.transactionInWitness.length - 1];
        this.getOriginalContractAddress(Buffer.from(controlBlock, 'hex'));

        const outputWitness: TransactionOutput = this.getWitnessOutput(this.contractAddress);

        this.setBurnedFee(outputWitness);

        // We get the sender address
        if (!deployerPubKey) {
            throw new Error(`OP_NET: Invalid sender address.`);
        }

        this._from = new Address(this.deployerPubKey);

        if (!this._from.isValid(this.network)) {
            throw new Error(`OP_NET: Invalid sender address.`);
        }

        /** Decompress contract bytecode if needed */
        this.decompress();
    }

    private getOriginalContractAddress(controlBlock: Buffer): void {
        if (!this.deployerPubKey) throw new Error('Deployer public key not found');
        if (!this.contractSigner) throw new Error('Contract signer not found');
        if (!this.contractSeed) throw new Error('Contract seed not found');
        if (!this.bytecode) throw new Error('Compressed bytecode not found');

        const params: ContractAddressVerificationParams = {
            deployerPubKey: this.deployerPubKey,
            contractSaltPubKey: Buffer.from(this.contractSigner.publicKey),
            originalSalt: this.contractSeed,
            bytecode: this.bytecode,
            calldata: this._calldata,
            network: this.network,
        };

        try {
            const tapContractAddress: boolean = TapscriptVerificator.verifyControlBlock(
                params,
                controlBlock,
            );

            if (!tapContractAddress) {
                throw new Error(`OP_NET: Invalid contract address.`);
            }
        } catch (e) {
            throw new Error(`OP_NET: Invalid contract address. ${e}`);
        }
    }

    /** We must check if the bytecode was compressed using GZIP. If so, we must decompress it. */
    private decompress(): void {
        if (!this.bytecode) throw new Error('Bytecode not found');
        this.bytecode = this.decompressData(this.bytecode);

        if (this._calldata) this._calldata = this.decompressData(this._calldata);
    }

    private getDeploymentWitnessData(
        scriptData: Array<number | Buffer>,
    ): DeploymentWitnessData | undefined {
        const rawPubKey = scriptData.shift();
        if (!Buffer.isBuffer(rawPubKey)) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_TOALTSTACK) {
            return;
        }

        const deployerPubKey = scriptData.shift();
        if (!Buffer.isBuffer(deployerPubKey)) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_CHECKSIGVERIFY) {
            return;
        }

        const contractSaltPubKey = scriptData.shift();
        if (!Buffer.isBuffer(contractSaltPubKey)) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_CHECKSIGVERIFY) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_HASH160) {
            return;
        }

        const deployerPubKeyHash = scriptData.shift();
        if (!Buffer.isBuffer(deployerPubKeyHash)) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_EQUALVERIFY) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_HASH256) {
            return;
        }

        const contractSaltHash = scriptData.shift();
        if (!Buffer.isBuffer(contractSaltHash)) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_EQUALVERIFY) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_DEPTH) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_1) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_NUMEQUAL) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_IF) {
            return;
        }

        const magic = scriptData.shift();
        if (!Buffer.isBuffer(magic)) {
            return;
        }

        // Calldata flag
        if (scriptData.shift() !== opcodes.OP_0) {
            return;
        }

        const calldata: Buffer | undefined = DeploymentTransaction.getDataFromWitness(
            scriptData,
            opcodes.OP_1NEGATE, // next opcode
        );

        if (
            calldata &&
            OPNetConsensus.consensus.CONTRACTS.MAXIMUM_CALLDATA_SIZE_DECOMPRESSED <
                calldata.byteLength
        ) {
            throw new Error(`OP_NET: Calldata length exceeds maximum allowed size.`);
        }

        // ... Future implementation before this opcode
        if (scriptData.shift() !== opcodes.OP_1NEGATE) {
            return;
        }

        const contractBytecode: Buffer | undefined =
            DeploymentTransaction.getDataFromWitness(scriptData);
        if (!contractBytecode) {
            throw new Error(`No contract bytecode found in deployment transaction.`);
        }

        if (
            OPNetConsensus.consensus.CONTRACTS.MAXIMUM_CONTRACT_SIZE_DECOMPRESSED <
            contractBytecode.byteLength
        ) {
            throw new Error(`OP_NET: Contract length exceeds maximum allowed size.`);
        }

        return {
            rawPubKey,
            deployerPubKey,
            contractSaltPubKey,
            deployerPubKeyHash,
            contractSaltHash,
            bytecode: contractBytecode,
            calldata: undefined,
        };
    }

    /* For future implementation we return an array here. */
    private getInputWitnessTransactions(): TransactionInput[] {
        return [this.inputs[this.vInputIndex]];
    }
}
