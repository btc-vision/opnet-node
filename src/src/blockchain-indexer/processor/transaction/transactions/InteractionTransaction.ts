import { TransactionData, VIn, VOut } from '@btc-vision/bsi-bitcoin-rpc';
import { DataConverter } from '@btc-vision/bsi-db';
import bitcoin, { address, initEccLib, opcodes, payments } from 'bitcoinjs-lib';
import { Binary } from 'mongodb';
import { InteractionTransactionDocument } from '../../../../db/interfaces/ITransactionDocument.js';
import { EvaluatedEvents, EvaluatedResult } from '../../../../vm/evaluated/EvaluatedResult.js';
import {
    InteractionTransactionType,
    OPNetTransactionTypes,
} from '../enums/OPNetTransactionTypes.js';
import { TransactionInput } from '../inputs/TransactionInput.js';
import { TransactionOutput } from '../inputs/TransactionOutput.js';
import { TransactionInformation } from '../PossibleOpNetTransactions.js';
import { Transaction } from '../Transaction.js';
import { AuthorityManager } from '../../../../poa/configurations/manager/AuthorityManager.js';
import { P2PVersion } from '../../../../poa/configurations/P2PVersion.js';
import { Address, BinaryReader } from '@btc-vision/bsi-binary';
import { WBTC_UNWRAP_SELECTOR, WBTC_WRAP_SELECTOR } from '../../../../poa/wbtc/WBTCRules.js';
import * as ecc from 'tiny-secp256k1';
import { OPNetConsensus } from '../../../../poa/configurations/OPNetConsensus.js';

export interface InteractionWitnessData {
    senderPubKey: Buffer;
    interactionSaltPubKey: Buffer;
    senderPubKeyHash160: Buffer;
    contractSecretHash160: Buffer;
    calldata: Buffer;
}

initEccLib(ecc);

const authorityManager = AuthorityManager.getAuthority(P2PVersion);

/* TODO: Potentially allow multiple contract interaction per transaction since BTC supports that? Maybe, in the future, for now let's stick with one. */
export class InteractionTransaction extends Transaction<InteractionTransactionType> {
    public static LEGACY_INTERACTION: Buffer = Buffer.from([
        opcodes.OP_CHECKSIGVERIFY,
        opcodes.OP_CHECKSIGVERIFY,

        opcodes.OP_HASH160,
        opcodes.OP_EQUALVERIFY,

        opcodes.OP_HASH160,
        opcodes.OP_EQUALVERIFY,

        opcodes.OP_DEPTH,
        opcodes.OP_1,
        opcodes.OP_NUMEQUAL,
        opcodes.OP_IF,

        opcodes.OP_1NEGATE,

        opcodes.OP_ELSE,
        opcodes.OP_1,
        opcodes.OP_ENDIF,
    ]);

    public readonly transactionType: InteractionTransactionType = InteractionTransaction.getType();

    protected senderPubKeyHash: Buffer | undefined;
    protected senderPubKey: Buffer | undefined;
    protected contractSecretHash: Buffer | undefined;
    protected contractSecret: Buffer | undefined;
    protected interactionPubKey: Buffer | undefined;

    protected interactionWitnessData: InteractionWitnessData | undefined;

    public constructor(
        rawTransactionData: TransactionData,
        vIndexIn: number,
        blockHash: string,
        blockHeight: bigint,
        network: bitcoin.networks.Network,
    ) {
        super(rawTransactionData, vIndexIn, blockHash, blockHeight, network);
    }

    protected _calldata: Buffer | undefined;

    public get calldata(): Buffer {
        if (!this._calldata) {
            throw new Error(`No calldata found for transaction ${this.txid}`);
        }

        const newCalldata = Buffer.alloc(this._calldata.byteLength);
        if (this._calldata) this._calldata.copy(newCalldata);

        return newCalldata;
    }

    protected _contractAddress: Address | undefined;

    public get contractAddress(): Address {
        return this._contractAddress as string;
    }

    public set contractAddress(contractAddress: Address) {
        this._contractAddress = contractAddress;
    }

    protected _txOrigin: Address | undefined;

    public get txOrigin(): Address {
        return this._txOrigin || this.from;
    }

    protected _msgSender: Address | undefined;

    public get msgSender(): Address | undefined {
        return this._msgSender;
    }

    public static is(data: TransactionData): TransactionInformation | undefined {
        const vIndex = this._is(data, this.LEGACY_INTERACTION);

        if (vIndex === -1) {
            return;
        }

        return {
            type: this.getType(),
            vInIndex: vIndex,
        };
    }

    public static getInteractionWitnessDataHeader(
        scriptData: Array<number | Buffer>,
    ): Omit<InteractionWitnessData, 'calldata'> | undefined {
        const senderPubKey: Buffer = scriptData.shift() as Buffer;
        if (!Buffer.isBuffer(senderPubKey)) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_CHECKSIGVERIFY) {
            return;
        }

        const interactionSaltPubKey: Buffer = scriptData.shift() as Buffer;
        if (!Buffer.isBuffer(interactionSaltPubKey)) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_CHECKSIGVERIFY) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_HASH160) {
            return;
        }

        const senderPubKeyHash160: Buffer = scriptData.shift() as Buffer;
        if (scriptData.shift() !== opcodes.OP_EQUALVERIFY) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_HASH160) {
            return;
        }

        // hash of bech32 contract address.
        const contractSaltHash160: Buffer = scriptData.shift() as Buffer;
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

        return {
            senderPubKey,
            interactionSaltPubKey,
            senderPubKeyHash160,
            contractSecretHash160: contractSaltHash160,
        };
    }

    public static getInteractionWitnessData(
        scriptData: Array<number | Buffer>,
    ): InteractionWitnessData | undefined {
        const header = this.getInteractionWitnessDataHeader(scriptData);
        if (!header) {
            return;
        }

        // ... Future implementation before this opcode
        if (scriptData.shift() !== opcodes.OP_1NEGATE) {
            return;
        }

        const calldata: Buffer | undefined = this.getDataFromWitness(scriptData);
        if (!calldata) {
            throw new Error(`No contract bytecode found in deployment transaction.`);
        }

        if (
            OPNetConsensus.consensus.CONTRACTS.MAXIMUM_CALLDATA_SIZE_DECOMPRESSED <
            calldata.byteLength
        ) {
            throw new Error(`OP_NET: Calldata length exceeds maximum allowed size.`);
        }

        return {
            senderPubKey: header.senderPubKey,
            interactionSaltPubKey: header.interactionSaltPubKey,
            senderPubKeyHash160: header.senderPubKeyHash160,
            contractSecretHash160: header.contractSecretHash160,
            calldata,
        };
    }

    protected static getType(): InteractionTransactionType {
        return OPNetTransactionTypes.Interaction;
    }

    /**
     * Convert the transaction to a document.
     */
    public toDocument(): InteractionTransactionDocument {
        const receiptData: EvaluatedResult | undefined = this.receipt;
        const events: EvaluatedEvents | undefined = receiptData?.events;
        const receipt: Uint8Array | undefined = receiptData?.result;
        const receiptProofs: string[] = this.receiptProofs || [];

        if (receipt && receiptProofs.length === 0) {
            throw new Error(`No receipt proofs found for transaction ${this.txid}`);
        }

        return {
            ...super.toDocument(),
            from: this.from,
            contractAddress: this.contractAddress,

            calldata: new Binary(this.calldata),
            senderPubKeyHash: new Binary(this.senderPubKeyHash),
            contractSecret: new Binary(this.contractSecret),
            interactionPubKey: new Binary(this.interactionPubKey),

            wasCompressed: this.wasCompressed,
            receiptProofs: receiptProofs,

            gasUsed: DataConverter.toDecimal128(this.gasUsed),

            receipt: receipt ? new Binary(receipt) : undefined,
            events: this.convertEvents(events),
        };
    }

    public parseTransaction(
        vIn: VIn[],
        vOuts: VOut[],
        self: typeof InteractionTransaction = InteractionTransaction,
    ): void {
        super.parseTransaction(vIn, vOuts);

        this.parseTransactionData(self);
    }

    protected parseTransactionData(self: typeof InteractionTransaction): void {
        const inputOPNetWitnessTransactions = this.getInputWitnessTransactions();
        if (inputOPNetWitnessTransactions.length === 0) {
            throw new Error(
                `No input witness transactions found for deployment transaction ${this.txid}`,
            );
        }

        // TODO: If we add support multiple call inside a single transaction, we must make sure to check that we dont rescan old transaction without this check by specifying the block height.
        if (inputOPNetWitnessTransactions.length > 1) {
            throw new Error(
                `Multiple input witness transactions found for deployment transaction ${this.txid}. This is not implemented.`,
            );
        }

        /** As we only support one contract interaction per transaction, we can safely assume that the first element is the one we are looking for. */
        const scriptData = this.getWitnessWithMagic();
        if (!scriptData) {
            throw new Error(`No script data found for deployment transaction ${this.txid}`);
        }

        this.interactionWitnessData = self.getInteractionWitnessData(scriptData);
        if (!this.interactionWitnessData) {
            throw new Error(
                `Failed to parse interaction witness data for transaction ${this.txid}`,
            );
        }

        this._calldata = this.interactionWitnessData.calldata;

        const inputOPNetWitnessTransaction: TransactionInput = inputOPNetWitnessTransactions[0];
        const witnesses: string[] = inputOPNetWitnessTransaction.transactionInWitness;

        const contractSecret: Buffer = Buffer.from(witnesses[0], 'hex');
        const senderPubKey: Buffer = Buffer.from(witnesses[1], 'hex');

        /** Verify witness data */
        const hashSenderPubKey = bitcoin.crypto.hash160(senderPubKey);
        if (!hashSenderPubKey.equals(this.interactionWitnessData.senderPubKeyHash160)) {
            throw new Error(`Sender public key hash mismatch for transaction ${this.txid}`);
        }

        if (!senderPubKey.equals(this.interactionWitnessData.senderPubKey)) {
            throw new Error(
                `Sender public key mismatch for transaction ${this.txid}. Expected ${this.interactionWitnessData.senderPubKey.toString(
                    'hex',
                )} but got ${senderPubKey.toString('hex')}`,
            );
        }

        const { address } = payments.p2tr({ internalPubkey: senderPubKey, network: this.network });
        if (!address) {
            throw new Error(`Failed to generate sender address for transaction ${this.txid}`);
        }

        this._from = address;

        this.senderPubKeyHash = this.interactionWitnessData.senderPubKeyHash160;
        this.senderPubKey = this.interactionWitnessData.senderPubKey;

        /** Verify contract salt */
        const hashContractSalt = bitcoin.crypto.hash160(contractSecret);
        if (!hashContractSalt.equals(this.interactionWitnessData.contractSecretHash160)) {
            throw new Error(
                `Contract salt hash mismatch for transaction ${this.txid}. Expected ${this.interactionWitnessData.contractSecretHash160.toString(
                    'hex',
                )} but got ${hashContractSalt.toString('hex')}`,
            );
        }

        this.interactionPubKey = this.interactionWitnessData.interactionSaltPubKey;
        this.contractSecretHash = this.interactionWitnessData.contractSecretHash160;
        this.contractSecret = contractSecret;

        /** We must verify that the contract secret match with at least one output. */
        const outputWitness: TransactionOutput | undefined =
            this.getOutputWitnessFromSecret(contractSecret);

        if (!outputWitness) {
            throw new Error(
                `No output transaction found for contract secret for transaction ${this.txid}. Secret: ${contractSecret.toString(
                    'hex',
                )}`,
            );
        }

        const outputAddress = outputWitness.scriptPubKey.address;
        if (!outputAddress) {
            throw new Error(`No address found for contract witness output`);
        }

        this._contractAddress = outputAddress;

        /** We set the fee burned to the output witness */
        this.setBurnedFee(outputWitness);

        /** Decompress calldata if needed */
        this.decompressCalldata();

        this.verifyUnallowed();
    }

    /** We must verify that the transaction is not bypassing another transaction type. */
    protected verifyUnallowed(): void {
        // We handle wbtc checks here.
        if (authorityManager.WBTC_CONTRACT_ADDRESSES.includes(this.contractAddress)) {
            this.verifyWBTC();
        }
    }

    /**
     * Get the output witness from the secret. Note: If there is multiple interaction in the same transaction, there should be only one output that match the secret.
     * @param secret Buffer
     * @private
     */
    private getOutputWitnessFromSecret(secret: Buffer): TransactionOutput | undefined {
        for (let i = 0; i < this.outputs.length; i++) {
            const output = this.outputs[i];

            const scriptPubKey = output.scriptPubKey;
            const outAddress = scriptPubKey.address;

            if (!outAddress) {
                continue;
            }

            const bech32Address = address.fromBech32(outAddress);
            if (!bech32Address) {
                continue;
            }

            if (secret.equals(bech32Address.data)) {
                return output;
            }
        }

        return undefined;
    }

    /** We must check if the calldata was compressed using GZIP. If so, we must decompress it. */
    private decompressCalldata(): void {
        if (!this._calldata) throw new Error(`Calldata not specified in transaction.`);

        this._calldata = this.decompressData(this._calldata);
    }

    /* For future implementation we return an array here. */
    private getInputWitnessTransactions(): TransactionInput[] {
        return [this.inputs[this.vInputIndex]];
    }

    /**
     * Verify that the WBTC transaction is valid.
     */
    private verifyWBTC(): void {
        const selectorBytes = this.calldata.subarray(0, 4);
        const reader = new BinaryReader(selectorBytes);

        const selector = reader.readSelector();
        if (selector === WBTC_WRAP_SELECTOR || selector === WBTC_UNWRAP_SELECTOR) {
            throw new Error(`Invalid WBTC mint/burn transaction.`);
        }
    }
}
