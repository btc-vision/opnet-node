import { TransactionData, VIn, VOut } from '@btc-vision/bitcoin-rpc';
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
import { OPNet_MAGIC, Transaction } from '../Transaction.js';
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
            throw new Error(`No calldata found for transaction ${this.txidHex}`);
        }
        return Buffer.from(this._calldata);
    }

    protected _contractAddress: Address | undefined;

    public get contractAddress(): string {
        if (!this._contractAddress) {
            throw new Error(`Contract address not set for transaction ${this.txidHex}`);
        }
        return this._contractAddress.p2tr(this.network);
    }

    protected _txOrigin: Address | undefined;

    public get txOrigin(): Address {
        return this._txOrigin || this.from;
    }

    protected _msgSender: Address | undefined;

    public get msgSender(): Address | undefined {
        return this._msgSender;
    }

    public get address(): Address {
        if (!this._contractAddress) throw new Error('Contract address not found');
        return this._contractAddress;
    }

    /**
     * PATCH: We only allow P2TR. So we rely on `_is(...)` which rejects anything else.
     */
    public static async is(
        data: TransactionData,
        utxoResolver: (
            txid: string,
            vout: number,
        ) => Promise<{ scriptPubKeyHex: string; type: string } | undefined>,
    ): Promise<TransactionInformation | undefined> {
        // Only checks for LEGACY_INTERACTION pattern, but strictly in P2TR context.
        const vIndex = await this._is(data, this.LEGACY_INTERACTION, utxoResolver);
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

        // Enforce 32-byte pubkey only.
        const senderPubKey = scriptData.shift();
        if (!Buffer.isBuffer(senderPubKey) || senderPubKey.length !== 32) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_DUP) return;
        if (scriptData.shift() !== opcodes.OP_HASH256) return;

        const hashedSenderPubKey = scriptData.shift();
        if (!Buffer.isBuffer(hashedSenderPubKey) || hashedSenderPubKey.length !== 32) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_EQUALVERIFY) return;
        if (scriptData.shift() !== opcodes.OP_CHECKSIGVERIFY) return;

        const interactionSaltPubKey = scriptData.shift();
        if (!Buffer.isBuffer(interactionSaltPubKey) || interactionSaltPubKey.length !== 32) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_CHECKSIGVERIFY) return;

        if (scriptData.shift() !== opcodes.OP_HASH160) return;

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
        if (!Buffer.isBuffer(magic) || magic.length !== 2 || !magic.equals(OPNet_MAGIC)) {
            return;
        }

        return {
            header,
            senderPubKey,
            interactionSaltPubKey,
            hashedSenderPubKey,
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

        if (scriptData.shift() !== opcodes.OP_1NEGATE) {
            return;
        }

        const calldata: Buffer | undefined = this.getDataFromScript(scriptData);
        if (!calldata) {
            throw new Error(`No contract bytecode found in interaction transaction.`);
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

    public toDocument(): InteractionTransactionDocument {
        const receiptData: EvaluatedResult | undefined = this.receipt;
        const events: EvaluatedEvents | undefined = receiptData?.events;
        const receipt: Uint8Array | undefined = receiptData?.result;
        const receiptProofs: string[] = this.receiptProofs || [];

        if (receipt && receiptProofs.length === 0) {
            throw new Error(`No receipt proofs found for transaction ${this.txidHex}`);
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

        if (inputOPNetWitnessTransactions.length > 1) {
            throw new Error(
                `OP_NET: Multiple input witness transactions found. Reserved for future use.`,
            );
        }

        const scriptData = this.getWitnessWithMagic();
        if (!scriptData) {
            throw new Error(`OP_NET: No script data found in witness.`);
        }

        this.interactionWitnessData = self.getInteractionWitnessData(scriptData);
        if (!this.interactionWitnessData) {
            throw new Error(`OP_NET: Failed to parse interaction witness data.`);
        }

        this._calldata = this.interactionWitnessData.calldata;

        const inputOPNetWitnessTransaction: TransactionInput = inputOPNetWitnessTransactions[0];
        const witnesses: string[] = inputOPNetWitnessTransaction.transactionInWitness;

        // The first witness item might be your "contractSecret" or other salt
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

        /** We must verify that the contract secret matches at least one output. */
        const outputWitness: TransactionOutput | undefined = this.outputs[0];
        if (!outputWitness) {
            throw new Error(`OP_NET: Interaction miss configured. No outputs found.`);
        }

        const contractSecretRegenerated: Buffer =
            outputWitness.decodedSchnorrPublicKey ||
            outputWitness.decodedPubKeyHash ||
            (outputWitness.decodedPublicKeys || [])[0];

        if (!contractSecretRegenerated || !outputWitness.scriptPubKey.type) {
            throw new Error(`OP_NET: Interaction miss configured. No scriptPubKey type?`);
        }

        // Here, we only allow 'witness_v1_taproot'
        if (outputWitness.scriptPubKey.type !== 'witness_v1_taproot') {
            throw new Error(`OP_NET: Only P2TR is allowed for interactions.`);
        }

        // We build an Address from the contractSecret:
        this._contractAddress = this.regenerateContractAddress(contractSecret);
        this.verifyContractAddress(
            outputWitness.scriptPubKey.type,
            contractSecretRegenerated,
            this._contractAddress,
        );

        /** We set the fee burned to the output witness */
        this.setBurnedFee(outputWitness);

        this.verifyRewardUTXO();
        this.setGasFromHeader(this.interactionWitnessData.header);

        /** Decompress calldata if needed */
        this.decompressCalldata();
    }

    protected verifyContractAddress(type: string, pubKey: Buffer, contractAddress: Address): void {
        // We now only allow 'witness_v1_taproot'
        switch (type) {
            case 'witness_v1_taproot': {
                break;
            }
            default: {
                throw new Error(`OP_NET: Only P2TR interactions are supported at this time.`);
            }
        }

        // Ensure the “regenerated” public key matches the contract address
        if (
            pubKey.length !== contractAddress.length ||
            !crypto.timingSafeEqual(pubKey, contractAddress) ||
            !pubKey.equals(contractAddress)
        ) {
            throw new Error(`OP_NET: Malformed UTXO output or mismatched pubKey.`);
        }
    }

    protected regenerateContractAddress(contractSecret: Buffer): Address {
        // For demonstration, we assume 32 or 33 or 65 bytes possible
        // but in practice, you'd probably want only 32/33 for x-only or compressed public keys
        const isValid =
            contractSecret.length === 32 ||
            contractSecret.length === 33 ||
            contractSecret.length === 65;

        if (!isValid) {
            throw new Error(`OP_NET: Invalid contract address length specified.`);
        }

        // Quick check for compressed or x-only
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

    private decompressCalldata(): void {
        if (!this._calldata) {
            throw new Error(`Calldata not specified in transaction.`);
        }
        this._calldata = this.decompressData(this._calldata);
    }

    private getInputWitnessTransactions(): TransactionInput[] {
        return [this.inputs[this.vInputIndex]];
    }
}
