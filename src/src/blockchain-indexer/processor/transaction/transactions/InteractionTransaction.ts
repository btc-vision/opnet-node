import { TransactionData, VIn, VOut } from '@btc-vision/bitcoin-rpc';
import bitcoin, { initEccLib, networks, opcodes } from '@btc-vision/bitcoin';
import { Binary } from 'mongodb';
import {
    InteractionTransactionDocument,
    InteractionTransactionSafeThread,
} from '../../../../db/interfaces/ITransactionDocument.js';
import { EvaluatedEvents, EvaluatedResult } from '../../../../vm/evaluated/EvaluatedResult.js';
import {
    InteractionTransactionType,
    OPNetTransactionTypes,
} from '../enums/OPNetTransactionTypes.js';
import { TransactionInput } from '../inputs/TransactionInput.js';
import { TransactionOutput } from '../inputs/TransactionOutput.js';
import { TransactionInformation } from '../PossibleOPNetTransactions.js';
import { OPNet_MAGIC } from '../Transaction.js';
import { Address, AddressVerificator, Features } from '@btc-vision/transaction';
import * as ecc from 'tiny-secp256k1';
import { OPNetConsensus } from '../../../../poa/configurations/OPNetConsensus.js';
import { OPNetHeader } from '../interfaces/OPNetHeader.js';
import { SharedInteractionParameters } from './SharedInteractionParameters.js';
import { Feature } from '../features/Features.js';
import { AddressCache } from '../../AddressCache.js';

export interface InteractionWitnessData {
    senderPubKey: Buffer;
    interactionSaltPubKey: Buffer;
    hashedSenderPubKey: Buffer;
    contractSecretHash160: Buffer;
    calldata: Buffer;

    readonly header: OPNetHeader;
    readonly features: Feature<Features>[];
}

initEccLib(ecc);

export class InteractionTransaction extends SharedInteractionParameters<InteractionTransactionType> {
    public static LEGACY_INTERACTION: Buffer = Buffer.from([
        opcodes.OP_TOALTSTACK, // HEADER
        opcodes.OP_TOALTSTACK, // MINER
        opcodes.OP_TOALTSTACK, // PREIMAGE

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

    private p2opCached: string | undefined;

    public constructor(
        rawTransactionData: TransactionData,
        vIndexIn: number,
        blockHash: string,
        blockHeight: bigint,
        network: networks.Network,
        addressCache: AddressCache | undefined,
    ) {
        super(rawTransactionData, vIndexIn, blockHash, blockHeight, network, addressCache);
    }

    protected _contractAddress: Address | undefined;

    public get contractAddress(): string {
        if (!this._contractAddress) {
            throw new Error(`Contract address not set for transaction ${this.txidHex}`);
        }

        if (!this.p2opCached) {
            this.p2opCached = this._contractAddress.p2op(this.network);
        }

        return this.p2opCached;
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
     * PATCH: We only allow P2OP. So we rely on `_is(...)` which rejects anything else.
     */
    public static is(data: TransactionData): TransactionInformation | undefined {
        // Only checks for LEGACY_INTERACTION pattern, but strictly in P2OP context.
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

        const features = SharedInteractionParameters.decodeFeatures(header, scriptData);
        if (scriptData.shift() !== opcodes.OP_1NEGATE) {
            return;
        }

        return {
            header,
            senderPubKey,
            interactionSaltPubKey,
            hashedSenderPubKey,
            contractSecretHash160: contractSaltHash160,
            features,
        };
    }

    public static getInteractionWitnessData(
        scriptData: Array<number | Buffer>,
    ): InteractionWitnessData | undefined {
        const tx = this.getInteractionWitnessDataHeader(scriptData);
        if (!tx) {
            return;
        }

        const calldata: Buffer | undefined = this.getDataFromScript(scriptData);
        if (!calldata) {
            throw new Error(`No contract bytecode found in interaction transaction.`);
        }

        if (
            OPNetConsensus.consensus.CONTRACTS.MAXIMUM_CALLDATA_SIZE_COMPRESSED <
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
            features: tx.features,
            calldata,
        };
    }

    protected static getType(): InteractionTransactionType {
        return OPNetTransactionTypes.Interaction;
    }

    public restoreFromDocument(
        doc: InteractionTransactionSafeThread,
        rawTransactionData: TransactionData,
    ): void {
        super.restoreFromDocument(doc, rawTransactionData);

        this._contractAddress = new Address(doc.contractAddress);

        const from = new Address(doc.from, doc.fromLegacy);
        this._txOrigin = from;
        this._msgSender = from;

        this._calldata = Buffer.from(doc.calldata.buffer);
        this.setMiner(Buffer.from(doc.miner.buffer), Buffer.from(doc.preimage.buffer));

        this.senderPubKeyHash = Buffer.from(doc.senderPubKeyHash.buffer);
        this.contractSecret = Buffer.from(doc.contractSecret.buffer);
        this.interactionPubKey = Buffer.from(doc.interactionPubKey.buffer);
        this.wasCompressed = doc.wasCompressed;
    }

    public toThreadSafe(): InteractionTransactionSafeThread {
        if (!this.contractSecret)
            throw new Error(`Contract secret not set for transaction ${this.txidHex}`);
        if (!this.senderPubKeyHash)
            throw new Error(`Sender public key hash not set for transaction ${this.txidHex}`);
        if (!this.interactionPubKey)
            throw new Error(`Interaction public key not set for transaction ${this.txidHex}`);

        return {
            ...super.toThreadSafe(),
            contractAddress: this.contractSecret,
            from: this.from,
            fromLegacy: this.from.tweakedPublicKeyToBuffer(),
            calldata: this.calldata,
            preimage: this.preimage,
            miner: this.miner,
            senderPubKeyHash: this.senderPubKeyHash,
            contractSecret: this.contractSecret,
            interactionPubKey: this.interactionPubKey,
            wasCompressed: this.wasCompressed,
        };
    }

    public toDocument(): InteractionTransactionDocument {
        const receiptData: EvaluatedResult | undefined = this.receipt;
        const events: EvaluatedEvents | undefined = receiptData?.events;
        const receipt: Uint8Array | undefined = receiptData?.result;
        const receiptProofs: string[] = this.receiptProofs || [];

        if (receipt && receiptProofs.length === 0) {
            throw new Error(`No receipt proofs found for transaction ${this.txidHex}`);
        }

        return {
            ...super.toDocument(),
            from: new Binary(this.from),
            fromLegacy: new Binary(this.from.tweakedPublicKeyToBuffer()),
            contractAddress: this.contractAddress,
            contractPublicKey: new Binary(this.address),

            calldata: new Binary(this.calldata),
            preimage: new Binary(this.preimage),

            senderPubKeyHash: new Binary(this.senderPubKeyHash),
            contractSecret: new Binary(this.contractSecret),
            interactionPubKey: new Binary(this.interactionPubKey),

            wasCompressed: this.wasCompressed,
            receiptProofs: receiptProofs,

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

        const scriptData = this.getParsedScript(3);
        if (!scriptData) {
            throw new Error(`OP_NET: No script data found in witness.`);
        }

        this.interactionWitnessData = self.getInteractionWitnessData(scriptData);
        if (!this.interactionWitnessData) {
            throw new Error(`OP_NET: Failed to parse interaction witness data.`);
        }

        this.parseFeatures(this.interactionWitnessData.features);
        this._calldata = this.interactionWitnessData.calldata;

        const inputOPNetWitnessTransaction: TransactionInput = inputOPNetWitnessTransactions[0];
        const witnesses: Buffer[] = inputOPNetWitnessTransaction.transactionInWitness;

        // The first witness item might be your "contractSecret" or other salt
        const contractSecret: Buffer = witnesses[0];
        const senderPubKey: Buffer = Buffer.from([
            this.interactionWitnessData.header.publicKeyPrefix,
            ...this.interactionWitnessData.senderPubKey,
        ]);

        //const senderPubKeyStr = senderPubKey.toString('hex');

        /** Verify witness data */
        const hashSenderPubKey = bitcoin.crypto.hash256(this.interactionWitnessData.senderPubKey);
        if (!this.safeEq(hashSenderPubKey, this.interactionWitnessData.hashedSenderPubKey)) {
            throw new Error(`OP_NET: Sender public key hash mismatch.`);
        }

        this._from = new Address(Buffer.alloc(32), senderPubKey);
        if (!this._from.isValidLegacyPublicKey(this.network)) {
            throw new Error(`OP_NET: Invalid sender address.`);
        }

        this.senderPubKeyHash = this.interactionWitnessData.hashedSenderPubKey;
        this.senderPubKey = senderPubKey;

        /** Verify contract salt */
        const hashContractSalt = bitcoin.crypto.hash160(contractSecret);
        if (!this.safeEq(hashContractSalt, this.interactionWitnessData.contractSecretHash160)) {
            throw new Error(`OP_NET: Contract salt hash mismatch.`);
        }

        this.interactionPubKey = this.interactionWitnessData.interactionSaltPubKey;
        this.contractSecretHash = this.interactionWitnessData.contractSecretHash160;
        this.contractSecret = contractSecret;

        this.setMiner(
            this.interactionWitnessData.header.minerMLDSAPublicKey,
            this.interactionWitnessData.header.solution,
        );

        /** We must verify that the contract secret matches at least one output. */
        /*const outputWitness: TransactionOutput | undefined = this.outputs[0];
        if (!outputWitness) {
            throw new Error(`OP_NET: Interaction miss configured. No outputs found.`);
        }

        // Here, we only allow 'witness_v1_taproot'
        if (outputWitness.scriptPubKey.type !== 'witness_unknown') {
            throw new Error(`OP_NET: Only P2OP is allowed for interactions.`);
        }*/

        // We build an Address from the contractSecret:
        this._contractAddress = this.regenerateContractAddress(contractSecret);

        // Disabled
        // this.verifyContractAddress(outputWitness, hashContractSalt);

        /** We set the fee burned to the output witness */
        //this.setBurnedFee(outputWitness);

        this.verifyRewardUTXO(0);
        this.setGasFromHeader(this.interactionWitnessData.header);

        /** Decompress calldata if needed */
        this.decompressCalldata();
        this.verifySpecialContract();
    }

    protected verifyContractAddress(
        outputWitness: TransactionOutput,
        hashContractSalt: Buffer,
    ): void {
        if (!this._contractAddress) throw new Error(`Contract address not set for transaction.`);

        // We now only allow 'witness_unknown'
        switch (outputWitness.scriptPubKey.type) {
            case 'witness_unknown': {
                break;
            }

            default: {
                throw new Error(`OP_NET: Only P2OP interactions are supported at this time.`);
            }
        }

        const decodedAddress = this.decodeAddress(outputWitness);
        if (!decodedAddress) {
            throw new Error(`OP_NET: Failed to decode address from output witness.`);
        }

        const contractScript = outputWitness.scriptPubKey.hex;
        if (!contractScript.startsWith('60')) {
            throw new Error(`OP_NET: Output does not have a valid p2op address.`);
        }

        // We only allow P2OP interactions, so we check the type of the scriptPubKey
        const scriptBuffer = Buffer.from(contractScript, 'hex');
        const contractKey = scriptBuffer.subarray(3); // Skip OP_16 and get the next 32 bytes

        if (!this.safeEq(contractKey, hashContractSalt) || !contractKey.equals(hashContractSalt)) {
            throw new Error(`OP_NET: Malformed UTXO output or mismatched pubKey.`);
        }

        if (this.contractAddress !== decodedAddress) {
            throw new Error(`OP_NET: Contract address does not match output witness address.`);
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

        const str = contractSecret.toString('hex');
        if (!AddressVerificator.isValidPublicKey(str, this.network)) {
            throw new Error(`OP_NET: Invalid contract pubkey specified.`);
        }

        return new Address(contractSecret);
    }

    private verifySpecialContract(): void {
        if (!this._contractAddress) {
            throw new Error(`Contract address not set for transaction ${this.txidHex}`);
        }

        this.specialSettings = OPNetConsensus.specialContract(this._contractAddress.toHex());
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
