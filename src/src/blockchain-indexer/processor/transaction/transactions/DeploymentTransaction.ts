import { TransactionData, VIn, VOut } from '@btc-vision/bitcoin-rpc';
import bitcoin, { networks, opcodes, toXOnly } from '@btc-vision/bitcoin';
import { ECPairInterface } from 'ecpair';
import { DeploymentTransactionDocument } from '../../../../db/interfaces/ITransactionDocument.js';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { TransactionInput } from '../inputs/TransactionInput.js';
import { TransactionOutput } from '../inputs/TransactionOutput.js';
import { TransactionInformation } from '../PossibleOpNetTransactions.js';
import { OPNet_MAGIC, Transaction } from '../Transaction.js';
import crypto from 'crypto';

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
import { OPNetHeader } from '../interfaces/OPNetHeader.js';

interface DeploymentWitnessData {
    readonly header: OPNetHeader;

    readonly senderPubKey: Buffer;
    hashedSenderPubKey: Buffer;

    contractSaltPubKey: Buffer;
    contractSaltHash: Buffer;

    readonly bytecode: Buffer;
    readonly calldata?: Buffer;
}

export class DeploymentTransaction extends Transaction<OPNetTransactionTypes.Deployment> {
    public static LEGACY_DEPLOYMENT_SCRIPT: Buffer = Buffer.from([
        opcodes.OP_TOALTSTACK,
        opcodes.OP_TOALTSTACK, // PREIMAGE

        opcodes.OP_DUP,
        opcodes.OP_HASH256,
        opcodes.OP_EQUALVERIFY,

        opcodes.OP_CHECKSIGVERIFY,
        opcodes.OP_CHECKSIGVERIFY,

        opcodes.OP_HASH256, // diff between deploys and interactions
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

    public constructor(
        rawTransactionData: TransactionData,
        vInputIndex: number,
        blockHash: string,
        blockHeight: bigint,
        network: networks.Network,
    ) {
        super(rawTransactionData, vInputIndex, blockHash, blockHeight, network);
    }

    protected _contractTweakedPublicKey: Buffer | undefined;

    public get contractTweakedPublicKey(): Buffer {
        if (!this._contractTweakedPublicKey) {
            throw new Error(`OP_NET: Contract tweaked public key not found.`);
        }

        return this._contractTweakedPublicKey;
    }

    protected _contractAddress: Address | undefined;

    public get contractAddress(): string {
        if (!this._contractAddress) throw new Error('OP_NET: Contract address not found');
        return this._contractAddress.p2tr(this.network);
    }

    public get address(): Address {
        if (!this._contractAddress) throw new Error('OP_NET: Contract address not found');
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
            throw new Error(`OP_NET: No receipt proofs.`);
        }

        if (!this._contractAddress) {
            throw new Error(`OP_NET: No contract address found.`);
        }

        const fromPubKey: Uint8Array = this.from.originalPublicKey || this.from;
        return {
            ...super.toDocument(),
            from: new Binary(fromPubKey),
            contractAddress: this.contractAddress,
            contractTweakedPublicKey: new Binary(this.address),

            calldata: new Binary(this.calldata),
            preimage: new Binary(this.preimage),

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
            throw new Error(`OP_NET: No input witness transactions.`);
        }

        if (inputOPNetWitnessTransactions.length > 1) {
            throw new Error(`OP_NET: Cannot deploy multiple contracts at the same time.`);
        }

        /** Contract should ALWAYS have ONLY ONE input witness transaction */
        const scriptData = this.getWitnessWithMagic();
        if (!scriptData) {
            throw new Error(`OP_NET: No script data.`);
        }

        const deploymentWitnessData = this.getDeploymentWitnessData(scriptData);
        if (!deploymentWitnessData) {
            throw new Error(`OP_NET: No deployment witness data.`);
        }

        /** We must verify the contract address */
        const inputTxId = this.inputs[this.vInputIndex].originalTransactionId;
        if (!inputTxId) {
            throw new Error(`OP_NET: No input transaction id.`);
        }

        const inputOPNetWitnessTransaction: TransactionInput = inputOPNetWitnessTransactions[0];
        const witnesses: string[] = inputOPNetWitnessTransaction.transactionInWitness;
        const originalSalt = Buffer.from(witnesses[0], 'hex');

        // Regenerate raw public key
        const deployerPubKey = Buffer.from([
            deploymentWitnessData.header.publicKeyPrefix,
            ...deploymentWitnessData.senderPubKey,
        ]);

        this.deployerPubKey = deployerPubKey;

        // Verify sender pubkey
        const hashSenderPubKey = bitcoin.crypto.hash256(deploymentWitnessData.senderPubKey);
        if (!crypto.timingSafeEqual(hashSenderPubKey, deploymentWitnessData.hashedSenderPubKey)) {
            throw new Error(`OP_NET: Sender public key hash mismatch.`);
        }
        this.deployerPubKeyHash = hashSenderPubKey;

        // end of verify sender pubkey

        // regenerate address
        this._from = new Address(this.deployerPubKey);
        if (!this._from.isValid(this.network)) {
            throw new Error(`OP_NET: Invalid sender address.`);
        }

        // Verify salt validity.
        if (originalSalt.byteLength < 32 || originalSalt.byteLength > 128) {
            throw new Error(`OP_NET: Salt should be between 32 and 128 bytes.`);
        }

        this.contractSeed = originalSalt;

        /** Verify contract salt */
        const hashOriginalSalt: Buffer = bitcoin.crypto.hash256(originalSalt);
        if (!crypto.timingSafeEqual(hashOriginalSalt, deploymentWitnessData.contractSaltHash)) {
            throw new Error(`OP_NET: Invalid contract salt hash found in deployment transaction.`);
        }

        this.contractSaltHash = hashOriginalSalt;

        // Set bytecode and calldata
        this.bytecode = deploymentWitnessData.bytecode;
        this._calldata = deploymentWitnessData.calldata;

        /** Restore contract seed/address */
        this._contractTweakedPublicKey = TapscriptVerificator.getContractSeed(
            toXOnly(deployerPubKey),
            this.bytecode,
            hashOriginalSalt,
        );

        /** Generate contract segwit address */
        this._contractAddress = new Address(Buffer.from(this._contractTweakedPublicKey));

        this.contractSigner = EcKeyPair.fromSeedKeyPair(
            this._contractTweakedPublicKey,
            this.network,
        );

        if (
            !this.contractSigner.publicKey ||
            !deploymentWitnessData.contractSaltPubKey.equals(toXOnly(this.contractSigner.publicKey))
        ) {
            throw new Error(`OP_NET: Invalid contract signer.`);
        }

        this._preimage = deploymentWitnessData.header.preimage;

        /** We regenerate the contract address and verify it */
        const input0: TransactionInput = this.inputs[0];
        const controlBlock = input0.transactionInWitness[input0.transactionInWitness.length - 1];
        this.getOriginalContractAddress(
            Buffer.from(controlBlock, 'hex'),
            deploymentWitnessData.header.priorityFeeSat,
        );

        const outputWitness: TransactionOutput = this.outputs[0]; // SHOULD ALWAYS BE 0.
        if (outputWitness?.scriptPubKey?.address !== this.contractAddress) {
            throw new Error(`OP_NET: Invalid contract address.`);
        }

        /** We set the fee burned to the output witness */
        this.setBurnedFee(outputWitness);

        // TODO: Verify preimage, from db for existing preimage, now, we have to be careful so people may not exploit this check.
        // If an attacker send the same preimage as someone else, he may be able to cause a reversion of the transaction of the other person.
        // We have to make it so it only checks if the preimage was used from block range: 0 to currentHeight - 10.
        // We allow duplicates in the last 10 blocks to prevent this attack.
        // If the preimage was already used, we revert the transaction with PREIMAGE_ALREADY_USED.
        this.verifyRewardUTXO();
        this.setGasFromHeader(deploymentWitnessData.header);

        /** Decompress contract bytecode if needed */
        this.decompress();
    }

    private getOriginalContractAddress(controlBlock: Buffer, priorityFee: bigint): void {
        if (!this.deployerPubKey) throw new Error('Deployer public key not found');
        if (!this.contractSigner) throw new Error('Contract signer not found');
        if (!this.contractSeed) throw new Error('Contract seed not found');
        if (!this.bytecode) throw new Error('Compressed bytecode not found');

        const params: ContractAddressVerificationParams = {
            deployerPubKey: this.deployerPubKey,
            contractSaltPubKey: Buffer.from(this.contractSigner.publicKey),
            originalSalt: this.contractSeed,
            bytecode: this.bytecode,
            calldata:
                this._calldata && Buffer.isBuffer(this._calldata) && this._calldata.length > 0
                    ? this._calldata
                    : undefined,
            preimage: this.preimage,
            network: this.network,
            priorityFee: priorityFee,
        };

        let tapContractAddress: boolean;
        try {
            tapContractAddress = TapscriptVerificator.verifyControlBlock(params, controlBlock);
        } catch (e) {
            throw new Error(`OP_NET: Invalid contract address. ${e}`);
        }

        if (!tapContractAddress) {
            throw new Error(`OP_NET: Invalid contract address.`);
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
        const header = DeploymentTransaction.decodeOPNetHeader(scriptData);
        if (!header) {
            return;
        }

        // Enforce 32 bytes pubkey only.
        const senderPubKey = scriptData.shift();
        if (!Buffer.isBuffer(senderPubKey) || senderPubKey.length !== 32) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_DUP) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_HASH256) {
            return;
        }

        const hashedSenderPubKey = scriptData.shift();
        if (!Buffer.isBuffer(hashedSenderPubKey) || hashedSenderPubKey.length !== 32) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_EQUALVERIFY) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_CHECKSIGVERIFY) {
            return;
        }

        // end of checks for sender pubkey

        const contractSaltPubKey = scriptData.shift();
        if (!Buffer.isBuffer(contractSaltPubKey) || contractSaltPubKey.length !== 32) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_CHECKSIGVERIFY) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_HASH256) {
            return;
        }

        // end of checks for contract salt pubkey

        const contractSaltHash = scriptData.shift();
        if (!Buffer.isBuffer(contractSaltHash) || contractSaltHash.length !== 32) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_EQUALVERIFY) {
            return;
        }

        // end of checks for contract salt hash

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
        if (!Buffer.isBuffer(magic) || magic.length !== 2 || !magic.equals(OPNet_MAGIC)) {
            return;
        }

        // Calldata flag
        if (scriptData.shift() !== opcodes.OP_0) {
            return;
        }

        const calldata: Buffer | undefined = DeploymentTransaction.getDataFromScript(
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
            DeploymentTransaction.getDataFromScript(scriptData);
        if (!contractBytecode) {
            throw new Error(`OP_NET: No contract bytecode.`);
        }

        if (
            OPNetConsensus.consensus.CONTRACTS.MAXIMUM_CONTRACT_SIZE_DECOMPRESSED <
            contractBytecode.byteLength
        ) {
            throw new Error(`OP_NET: Contract length exceeds maximum allowed size.`);
        }

        return {
            header,
            hashedSenderPubKey,
            senderPubKey,
            contractSaltPubKey,
            contractSaltHash,
            bytecode: contractBytecode,
            calldata: calldata,
        };
    }

    /* For future implementation we return an array here. */
    private getInputWitnessTransactions(): TransactionInput[] {
        return [this.inputs[this.vInputIndex]];
    }
}
