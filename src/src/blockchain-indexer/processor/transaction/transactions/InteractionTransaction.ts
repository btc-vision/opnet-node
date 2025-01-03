import { TransactionData, VIn, VOut } from '@btc-vision/bsi-bitcoin-rpc';
import { DataConverter } from '@btc-vision/bsi-db';
import bitcoin, { initEccLib, networks, opcodes } from '@btc-vision/bitcoin';
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
import { Address, AddressVerificator } from '@btc-vision/transaction';
import * as ecc from 'tiny-secp256k1';
import { OPNetConsensus } from '../../../../poa/configurations/OPNetConsensus.js';
import crypto from 'crypto';
import { OPNetHeader } from '../interfaces/OPNetHeader.js';

export interface InteractionWitnessData {
    senderPubKey: Buffer;
    interactionSaltPubKey: Buffer;
    hashedSenderPubKey: Buffer;
    contractSecretHash160: Buffer;
    calldata: Buffer;

    readonly header: OPNetHeader;
}

initEccLib(ecc);

/* TODO: Potentially allow multiple contract interaction per transaction since BTC supports that? Maybe, in the future, for now let's stick with one. */
export class InteractionTransaction extends Transaction<InteractionTransactionType> {
    public static LEGACY_INTERACTION: Buffer = Buffer.from([
        opcodes.OP_TOALTSTACK,
        opcodes.OP_TOALTSTACK, // preimage

        opcodes.OP_DUP,
        opcodes.OP_HASH256,
        opcodes.OP_EQUALVERIFY,

        opcodes.OP_CHECKSIGVERIFY,
        opcodes.OP_CHECKSIGVERIFY,

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
        network: networks.Network,
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

    public get contractAddress(): string {
        if (!this._contractAddress) {
            throw new Error(`Contract address not set for transaction ${this.txid}`);
        }

        return this._contractAddress.p2tr(this.network);
    }

    //public set contractAddress(contractAddress: Address) {
    //    this._contractAddress = contractAddress;
    //}

    public get address(): Address {
        if (!this._contractAddress) throw new Error('Contract address not found');
        return this._contractAddress;
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
        const header = InteractionTransaction.decodeOPNetHeader(scriptData);
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

        const interactionSaltPubKey = scriptData.shift();
        if (!Buffer.isBuffer(interactionSaltPubKey) || interactionSaltPubKey.length !== 32) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_CHECKSIGVERIFY) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_HASH160) {
            return;
        }

        const contractSaltHash160 = scriptData.shift();
        if (!Buffer.isBuffer(contractSaltHash160) || contractSaltHash160.length !== 20) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_EQUALVERIFY) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_DEPTH) return;
        if (scriptData.shift() !== opcodes.OP_1) return;
        if (scriptData.shift() !== opcodes.OP_NUMEQUAL) return;
        if (scriptData.shift() !== opcodes.OP_IF) return;

        const magic = scriptData.shift();
        if (!Buffer.isBuffer(magic) || magic.length !== 2) {
            return;
        }

        return {
            header: header,
            senderPubKey,
            interactionSaltPubKey,
            hashedSenderPubKey: hashedSenderPubKey,
            contractSecretHash160: contractSaltHash160,
        };
    }

    public static getInteractionWitnessData(
        scriptData: Array<number | Buffer>,
    ): InteractionWitnessData | undefined {
        const tx = this.getInteractionWitnessDataHeader(scriptData);
        if (!tx) {
            return;
        }

        // ... Future implementation before this opcode
        if (scriptData.shift() !== opcodes.OP_1NEGATE) {
            return;
        }

        const calldata: Buffer | undefined = this.getDataFromScript(scriptData);
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
            header: tx.header,
            senderPubKey: tx.senderPubKey,
            interactionSaltPubKey: tx.interactionSaltPubKey,
            hashedSenderPubKey: tx.hashedSenderPubKey,
            contractSecretHash160: tx.contractSecretHash160,
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

        const fromPubKey: Uint8Array = this.from.originalPublicKey || this.from;
        return {
            ...super.toDocument(),
            from: new Binary(fromPubKey),
            contractAddress: this.contractAddress,
            contractTweakedPublicKey: new Binary(this.address),

            calldata: new Binary(this.calldata),
            preimage: new Binary(this.preimage),

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
            throw new Error(`OP_NET: No input witness transactions found.`);
        }

        // TODO: If we add support multiple call inside a single transaction, we must make sure to check that we dont rescan old transaction without this check by specifying the block height.
        if (inputOPNetWitnessTransactions.length > 1) {
            throw new Error(
                `OP_NET: Multiple input witness transactions found. Reserved for future use.`,
            );
        }

        /** As we only support one contract interaction per transaction, we can safely assume that the first element is the one we are looking for. */
        const scriptData = this.getWitnessWithMagic();
        if (!scriptData) {
            throw new Error(`OP_NET: No script data found.`);
        }

        this.interactionWitnessData = self.getInteractionWitnessData(scriptData);
        if (!this.interactionWitnessData) {
            throw new Error(`OP_NET: Failed to parse interaction witness data.`);
        }

        this._calldata = this.interactionWitnessData.calldata;

        const inputOPNetWitnessTransaction: TransactionInput = inputOPNetWitnessTransactions[0];
        const witnesses: string[] = inputOPNetWitnessTransaction.transactionInWitness;

        const contractSecret: Buffer = Buffer.from(witnesses[0], 'hex');
        const senderPubKey: Buffer = Buffer.from([
            this.interactionWitnessData.header.publicKeyPrefix,
            ...this.interactionWitnessData.senderPubKey,
        ]);

        /** Verify witness data */
        const hashSenderPubKey = bitcoin.crypto.hash256(this.interactionWitnessData.senderPubKey);
        if (
            !crypto.timingSafeEqual(
                hashSenderPubKey,
                this.interactionWitnessData.hashedSenderPubKey,
            )
        ) {
            throw new Error(`OP_NET: Sender public key hash mismatch.`);
        }

        this._from = new Address(senderPubKey);
        if (!this._from.isValid(this.network)) {
            throw new Error(`OP_NET: Invalid sender address.`);
        }

        this.senderPubKeyHash = this.interactionWitnessData.hashedSenderPubKey;
        this.senderPubKey = senderPubKey;

        /** Verify contract salt */
        const hashContractSalt = bitcoin.crypto.hash160(contractSecret);
        if (
            !crypto.timingSafeEqual(
                hashContractSalt,
                this.interactionWitnessData.contractSecretHash160,
            )
        ) {
            throw new Error(`OP_NET: Contract salt hash mismatch.`);
        }

        this.interactionPubKey = this.interactionWitnessData.interactionSaltPubKey;
        this.contractSecretHash = this.interactionWitnessData.contractSecretHash160;
        this.contractSecret = contractSecret;

        this._preimage = this.interactionWitnessData.header.preimage;

        /** We must verify that the contract secret match with at least one output. */
        const outputWitness: TransactionOutput | undefined = this.outputs[0];
        if (!outputWitness) {
            throw new Error(`OP_NET: Interaction miss configured.`);
        }

        const contractSecretRegenerated: Buffer =
            outputWitness.decodedSchnorrPublicKey ||
            outputWitness.decodedPubKeyHash ||
            (outputWitness.decodedPublicKeys || [])[0];

        if (!contractSecretRegenerated || !outputWitness.scriptPubKey.type) {
            throw new Error(`OP_NET: Interaction miss configured.`);
        }

        this._contractAddress = this.regenerateContractAddress(contractSecret);

        this.verifyContractAddress(
            outputWitness.scriptPubKey.type,
            contractSecretRegenerated,
            this._contractAddress,
        );

        /** We set the fee burned to the output witness */
        this.setBurnedFee(outputWitness);

        // TODO: Verify preimage, from db for existing preimage, now, we have to be careful so people may not exploit this check.
        // If an attacker send the same preimage as someone else, he may be able to cause a reversion of the transaction of the other person.
        // We have to make it so it only checks if the preimage was used from block range: 0 to currentHeight - 10.
        // We allow duplicates in the last 10 blocks to prevent this attack.
        // If the preimage was already used, we revert the transaction with PREIMAGE_ALREADY_USED.
        this.verifyRewardUTXO();

        /** Decompress calldata if needed */
        this.decompressCalldata();
    }

    protected verifyContractAddress(type: string, pubKey: Buffer, contractAddress: Address): void {
        if (!type || !pubKey) {
            throw new Error(`OP_NET: Invalid contract address specified.`);
        }

        switch (type) {
            case 'witness_v1_taproot': {
                break;
            }
            case 'pubkey': {
                break;
            }
            default: {
                throw new Error(
                    `OP_NET: Only P2TR, legacy and pubkey interactions are supported at this time. Got ${type}`,
                );
            }
        }

        if (!crypto.timingSafeEqual(pubKey, contractAddress)) {
            throw new Error(`OP_NET: Malformed UTXO output.`);
        }
    }

    protected regenerateContractAddress(contractSecret: Buffer): Address {
        const isValid =
            contractSecret.length === 32 ||
            contractSecret.length === 33 ||
            contractSecret.length === 65;

        if (!isValid) {
            throw new Error(`OP_NET: Invalid contract address length specified.`);
        }

        if (contractSecret.length === 33) {
            if (contractSecret[0] !== 0x02 && contractSecret[0] !== 0x03) {
                throw new Error(`OP_NET: Invalid contract address prefix specified.`);
            }
        }

        if (contractSecret.length === 65) {
            if (
                contractSecret[0] !== 0x04 &&
                contractSecret[0] !== 0x06 &&
                contractSecret[0] !== 0x07
            ) {
                throw new Error(`OP_NET: Invalid contract uncompressed address specified.`);
            }
        }

        if (!AddressVerificator.isValidPublicKey(contractSecret.toString('hex'), this.network)) {
            throw new Error(`OP_NET: Invalid contract pubkey specified.`);
        }

        return new Address(contractSecret);
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
}
