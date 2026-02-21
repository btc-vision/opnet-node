import { TransactionData, VIn, VOut } from '@btc-vision/bitcoin-rpc';
import { DataConverter } from '@btc-vision/bsi-common';
import {
    alloc,
    concat,
    equals,
    fromHex,
    fromUtf8,
    Bytes32,
    Network,
    Script,
    Satoshi,
    script,
    Transaction as BitcoinTransaction,
} from '@btc-vision/bitcoin';
import { createBytes32, createPublicKey, createSatoshi } from '@btc-vision/ecpair';
import crypto from 'crypto';
import { Binary, Long } from 'mongodb';
import * as zlib from 'zlib';
import {
    ITransactionDocumentBasic,
    NetEventDocument,
    TransactionDocument,
    TransactionSafeThread,
} from '../../../db/interfaces/ITransactionDocument.js';
import { EvaluatedEvents, EvaluatedResult } from '../../../vm/evaluated/EvaluatedResult.js';
import { OPNetTransactionTypes } from './enums/OPNetTransactionTypes.js';
import { StrippedTransactionInput, TransactionInput } from './inputs/TransactionInput.js';
import { StrippedTransactionOutput, TransactionOutput } from './inputs/TransactionOutput.js';
import { Address, BinaryWriter, TimeLockGenerator } from '@btc-vision/transaction';
import { OPNetConsensus } from '../../../poc/configurations/OPNetConsensus.js';
import { OPNetHeader } from './interfaces/OPNetHeader.js';
import * as ecc from 'tiny-secp256k1';
import { AddressCache } from '../AddressCache.js';
import { Submission } from './features/Submission.js';

export const OPNet_MAGIC: Uint8Array = fromUtf8('op');
const GZIP_HEADER: Uint8Array = new Uint8Array([0x1f, 0x8b]);

// We need ECDSA/ECC functionality:
if (!ecc.isPoint(alloc(33, 2))) {
    throw new Error('tiny-secp256k1 initialization check failed');
}

export abstract class Transaction<T extends OPNetTransactionTypes> {
    public abstract readonly transactionType: T;

    public readonly inputs: TransactionInput[] = [];
    public readonly outputs: TransactionOutput[] = [];

    public readonly txidHex: string;
    public readonly raw: Uint8Array;

    public readonly inActiveChain: boolean | undefined;
    public readonly size: number;
    public readonly vSize: number;
    public readonly weight: number;
    public readonly version: number;
    public readonly lockTime: number;
    public readonly blockHash: string;
    public readonly confirmations: number | undefined;
    public readonly blockTime: number | undefined;
    public readonly time: number | undefined;

    public wasCompressed: boolean = false;

    protected readonly _computedIndexingHash: Uint8Array;
    protected readonly transactionHash: Uint8Array;
    protected readonly vInputIndex: number;
    protected receiptProofs: string[] | undefined;

    private readonly txid: Uint8Array;

    protected constructor(
        rawTransactionData: TransactionData,
        vInputIndex: number,
        blockHash: string,
        public readonly blockHeight: bigint,
        protected readonly network: Network,
        protected readonly addressCache: AddressCache | undefined,
    ) {
        if (rawTransactionData.blockhash && rawTransactionData.blockhash !== blockHash) {
            throw new Error(
                `Block hash mismatch: ${rawTransactionData.blockhash} !== ${blockHash}`,
            );
        }

        this.vInputIndex = vInputIndex;

        this.txid = fromHex(rawTransactionData.txid);
        this.txidHex = rawTransactionData.txid;
        this.transactionHash = fromHex(rawTransactionData.hash);
        this.raw = rawTransactionData.hex ? fromHex(rawTransactionData.hex) : new Uint8Array(0);

        this.inActiveChain = rawTransactionData.in_active_chain || false;
        this.size = rawTransactionData.size;
        this.vSize = rawTransactionData.vsize;
        this.weight = rawTransactionData.weight || 0;
        this.version = rawTransactionData.version;
        this.lockTime = rawTransactionData.locktime;
        this.blockHash = blockHash;
        this.confirmations = rawTransactionData.confirmations;
        this.blockTime = rawTransactionData.blocktime;
        this.time = rawTransactionData.time;

        this._computedIndexingHash = this.computeHashForTransaction();
    }

    protected _submission: Submission | undefined;

    public get submission(): Submission | undefined {
        return this._submission;
    }

    protected _preimage: Uint8Array | undefined;
    public get preimage(): Uint8Array {
        const preimage = new Uint8Array(this._preimage?.length || 0);
        if (this._preimage) {
            preimage.set(this._preimage);
        }
        return preimage;
    }

    protected _minerLegacyPublicKey: Uint8Array | undefined;

    public get minerLegacyPublicKey(): Uint8Array {
        const miner = new Uint8Array(this._minerLegacyPublicKey?.length || 0);
        if (this._minerLegacyPublicKey) {
            miner.set(this._minerLegacyPublicKey);
        }
        return miner;
    }

    protected _miner: Uint8Array | undefined;

    public get miner(): Uint8Array {
        const miner = new Uint8Array(this._miner?.length || 0);
        if (this._miner) {
            miner.set(this._miner);
        }
        return miner;
    }

    public get strippedInputs(): StrippedTransactionInput[] {
        if (this.inputs.length > OPNetConsensus.consensus.VM.UTXOS.MAXIMUM_INPUTS) {
            throw new Error(
                `Transaction exceeds maximum inputs limit: ${this.inputs.length} > ${OPNetConsensus.consensus.VM.UTXOS.MAXIMUM_INPUTS}`,
            );
        }

        return this.inputs.map((input) => input.toStripped());
    }

    public get strippedOutputs(): StrippedTransactionOutput[] {
        if (this.outputs.length > OPNetConsensus.consensus.VM.UTXOS.MAXIMUM_OUTPUTS) {
            throw new Error(
                `Transaction exceeds maximum outputs limit: ${this.outputs.length} > ${OPNetConsensus.consensus.VM.UTXOS.MAXIMUM_OUTPUTS}`,
            );
        }

        const outputs = this.outputs.map((output) => output.toStripped());

        return outputs.filter((output): output is StrippedTransactionOutput => !!output);
    }

    public get computedIndexingHash(): Uint8Array {
        return this._computedIndexingHash;
    }

    protected _revert: Uint8Array | undefined;

    public get revert(): Uint8Array | undefined {
        return this._revert;
    }

    public set revert(error: Uint8Array | undefined) {
        this._revert = error;
    }

    protected _receipt: EvaluatedResult | undefined;

    public get receipt(): EvaluatedResult | undefined {
        return this._receipt;
    }

    public set receipt(receipt: EvaluatedResult) {
        this._receipt = receipt;
    }

    protected _from: Address | undefined;

    public get from(): Address {
        if (!this._from) {
            throw new Error(`No sender address found for transaction ${this.txidHex}`);
        }
        return this._from;
    }

    protected _index: number = 0;

    public get index(): number {
        return this._index;
    }

    public set index(index: number) {
        this._index = index;
    }

    protected _originalIndex: number = 0;

    public set originalIndex(index: number) {
        this._originalIndex = index;
    }

    protected _burnedFee: bigint = 0n;

    public get burnedFee(): bigint {
        return this._burnedFee;
    }

    protected _reward: bigint = 0n;

    public get reward(): bigint {
        return this._reward;
    }

    public get totalFeeFund(): bigint {
        return this._burnedFee + this._reward;
    }

    protected _priorityFee: bigint = 0n;

    public get priorityFee(): bigint {
        return this._priorityFee;
    }

    protected _gasSatFee: bigint = 0n;

    public get gasSatFee(): bigint {
        return this._gasSatFee;
    }

    public get transactionId(): Uint8Array {
        return this.txid;
    }

    public get transactionIdString(): string {
        return this.txidHex;
    }

    public get hash(): Uint8Array {
        return this.transactionHash;
    }

    public get totalGasUsed(): bigint {
        if (!this._receipt) return 0n;

        return (this._receipt.gasUsed || 0n) + (this._receipt.specialGasUsed || 0n);
    }

    // Simple check for presence of OPNet magic
    public static dataIncludeOPNetMagic(data: Array<Uint8Array | number>): boolean {
        return data.some((value) => {
            if (typeof value === 'number') return false;
            if (value.byteLength !== OPNet_MAGIC.byteLength) return false;
            return equals(value, OPNet_MAGIC);
        });
    }

    public static verifyChecksum(
        scriptData: (number | Uint8Array)[],
        typeChecksum: Uint8Array,
    ): boolean {
        const checksum = this.getDataChecksum(scriptData);
        return equals(checksum, typeChecksum);
    }

    public static decompressBuffer(buffer: Uint8Array): { out: Uint8Array; compressed: boolean } {
        if (!buffer) {
            throw new Error('Buffer is undefined. Cannot decompress.');
        }
        const zlibHeader = buffer.subarray(0, 2);
        if (equals(zlibHeader, GZIP_HEADER)) {
            try {
                const decompressed = zlib.unzipSync(buffer, {
                    finishFlush: zlib.constants.Z_SYNC_FLUSH,
                    maxOutputLength: OPNetConsensus.consensus.COMPRESSION.MAX_DECOMPRESSED_SIZE,
                });
                return {
                    out: new Uint8Array(
                        decompressed.buffer,
                        decompressed.byteOffset,
                        decompressed.byteLength,
                    ),
                    compressed: true,
                };
            } catch {
                throw new Error('OP_NET: Invalid compressed data.');
            }
        }
        return { out: buffer, compressed: false };
    }

    protected static _is(data: TransactionData, typeChecksum: Uint8Array): number {
        let isCorrectType: number = -1;

        for (let y = 0; y < data.vin.length; y++) {
            const vIn = data.vin[y];
            const witnesses = vIn.txinwitness || [];

            // Invalid witness count.
            if (witnesses.length !== 5) {
                continue;
            }

            const signatureA = witnesses[1];
            const signatureB = witnesses[2];

            // not a valid signature
            if (signatureA.length !== 128 || signatureB.length !== 128) {
                continue;
            }

            // invalid control block
            if (witnesses[4].length !== 130) {
                continue;
            }

            const rawScriptHex = witnesses[3]; //witnesses.length - 2
            const rawScriptBuf = fromHex(rawScriptHex);

            let decodedScript: (number | Uint8Array)[] | null;
            try {
                decodedScript = script.decompile(rawScriptBuf);
            } catch {
                continue;
            }

            if (!decodedScript) {
                continue;
            }

            // Check OPNet magic
            if (!this.dataIncludeOPNetMagic(decodedScript)) {
                continue;
            }

            if (!this.verifyChecksum(decodedScript, typeChecksum)) {
                continue;
            }

            isCorrectType = y;
            break;
        }

        return isCorrectType;
    }

    protected static getDataChecksum(data: Array<Uint8Array | number>): Uint8Array {
        const checksum: number[] = [];
        for (let i = 0; i < data.length; i++) {
            if (typeof data[i] === 'number') {
                checksum.push(data[i] as number);
            }
        }
        return new Uint8Array(checksum);
    }

    public setMiner(miner: Uint8Array, preimage: Uint8Array) {
        const legacyPublicKey = this.verifyPreImage(new Address(miner), preimage);

        this._preimage = preimage;
        this._miner = miner;
        this._minerLegacyPublicKey = legacyPublicKey;
    }

    public verifyPreImage: (miner: Address, preimage: Uint8Array) => Uint8Array | undefined = (
        _miner: Address,
        _preimage: Uint8Array,
    ) => {
        throw new Error('Verify preimage method not implemented.');
    };

    public setReceiptProofs(proofs: string[] | undefined): void {
        this.receiptProofs = proofs;
    }

    public toBitcoinDocument(): ITransactionDocumentBasic<T> {
        return {
            id: this.transactionId,
            hash: this.hash,
            blockHeight: DataConverter.toDecimal128(this.blockHeight),
            index: this.index,
            inputs: this.inputs,
            outputs: this.outputs,
            OPNetType: this.transactionType,
            raw: this.raw,
        };
    }

    public restoreFromDocument(
        doc: TransactionSafeThread,
        rawTransactionData: TransactionData,
    ): void {
        this.parseInputs(rawTransactionData.vin);
        this.parseOutputs(rawTransactionData.vout);

        this._burnedFee = BigInt(doc.burnedBitcoin);
        this._priorityFee = BigInt(doc.priorityFee);
        this._reward = BigInt(doc.reward);
    }

    public toThreadSafe(): TransactionSafeThread {
        return {
            burnedBitcoin: this.burnedFee.toString(),
            priorityFee: this.priorityFee.toString(),
            reward: this.reward.toString(),
        };
    }

    public toDocument(): TransactionDocument<T> {
        const revertData: Uint8Array | undefined = this.revert;
        const inputDocs = this.inputs.map((inp) => inp.toDocument());
        const outputDocs = this.outputs.map((out) => out.toDocument());

        return {
            id: this.transactionId,
            hash: this.hash,
            blockHeight: DataConverter.toDecimal128(this.blockHeight),

            raw: this.raw,
            index: this.index,

            burnedBitcoin: DataConverter.toDecimal128(this._burnedFee),
            priorityFee: DataConverter.toDecimal128(this._priorityFee),
            reward: new Long(this._reward, true),

            gasUsed: DataConverter.toDecimal128(this.receipt ? this.receipt.gasUsed : 0n),
            specialGasUsed: DataConverter.toDecimal128(
                this.receipt ? this.receipt.specialGasUsed : 0n,
            ),

            inputs: inputDocs,
            outputs: outputDocs,
            OPNetType: this.transactionType,
            revert: revertData ? new Binary(revertData) : undefined,
        };
    }

    public parseTransaction(vIn: VIn[], vOuts: VOut[]): void {
        this.parseInputs(vIn);
        this.parseOutputs(vOuts);
    }

    /**
     * DOES A TAPROOT SCRIPT-PATH SIGNATURE CHECK
     * [OPTIONAL, NOT USED CURRENTLY]
     *
     * @param senderPubKey x-only or full public key. We'll convert it to x-only.
     * @param senderSig The Schnorr signature from the witness
     * @param leafScript The Tapscript used (extracted from witness)
     * @param leafVersion Typically 0xc0 for Tapscript
     * @param prevOutScript The UTXO's scriptPubKey (MUST be taproot)
     * @param prevOutValue The UTXO's value in satoshis
     */
    protected verifySenderSignature(
        senderPubKey: Uint8Array,
        senderSig: Uint8Array,
        leafScript: Uint8Array,
        leafVersion: number,
        prevOutScript: Uint8Array,
        prevOutValue: number,
    ): boolean {
        if (!senderPubKey) {
            throw new Error('OP_NET: No senderPubKey found to verify signature.');
        }

        const sighash = this.generateTapscriptSighashAll(
            leafScript,
            leafVersion,
            prevOutScript,
            prevOutValue,
        );

        let xOnlyPub: Uint8Array;
        if (senderPubKey.length === 33 && (senderPubKey[0] === 0x02 || senderPubKey[0] === 0x03)) {
            xOnlyPub = senderPubKey.subarray(1);
        } else if (senderPubKey.length === 32) {
            xOnlyPub = senderPubKey;
        } else {
            throw new Error('OP_NET: Unexpected public key length. Must be x-only or compressed.');
        }

        try {
            return ecc.verifySchnorr(sighash, xOnlyPub, senderSig);
        } catch {
            return false;
        }
    }

    protected setGasFromHeader(header: OPNetHeader): void {
        if (this.totalFeeFund < header.priorityFeeSat) {
            throw new Error(`OP_NET: Priority fee is higher than actually received.`);
        }

        this._gasSatFee = this.totalFeeFund - header.priorityFeeSat;
        this._priorityFee = header.priorityFeeSat;
    }

    protected verifyRewardUTXO(utxoIndex: number): void {
        if (!this._preimage) {
            throw new Error('Preimage not found');
        }

        const rewardOutput = this.outputs[utxoIndex]; // ALWAYS the second output.
        if (!rewardOutput) {
            return; // no reward output
        }

        if (!OPNetConsensus.allowUnsafeSignatures) {
            throw new Error(
                `Node need consensus upgrade. This is only possible once BIP360 is activated.`,
            );
        }

        // LEGACY ADDRESS ONLY
        if (
            !rewardOutput.scriptPubKey.address ||
            rewardOutput.scriptPubKey.type !== 'witness_v0_scripthash'
        ) {
            return; // reward output must be a P2SH address
        }

        const rewardChallenge = TimeLockGenerator.generateTimeLockAddress(
            createPublicKey(this.minerLegacyPublicKey),
            this.network,
            OPNetConsensus.consensus.EPOCH.TIMELOCK_BLOCKS_REWARD,
        );

        if (rewardOutput.scriptPubKey.address !== rewardChallenge.address) {
            return; // reward output does not match the challenge address, we ignore it.
        }

        this.setReward(rewardOutput);
    }

    protected convertEvents(events: EvaluatedEvents | undefined): NetEventDocument[] {
        if (!events) return [];
        const netEvents: NetEventDocument[] = [];
        for (const [contractAddr, contractEvents] of events) {
            for (const event of contractEvents) {
                netEvents.push({
                    contractAddress: contractAddr,
                    data: new Binary(event.data),
                    type: new Binary(this.strToBuffer(event.type)),
                });
            }
        }
        return netEvents;
    }

    protected setBurnedFee(witnessOutput: TransactionOutput): void {
        if (!witnessOutput.scriptPubKey.address) {
            throw new Error('No address found for contract witness output');
        }

        this._burnedFee = witnessOutput.value;
        if (this._burnedFee > 2000n) {
            throw new Error(`Burned too much fee (${this._burnedFee} satoshis)`);
        }
    }

    protected setReward(output: TransactionOutput): void {
        this._reward = output.value;
    }

    protected getParsedScript(
        expectedPositionInWitness: number,
        vIndex: number = this.vInputIndex,
    ): Array<Uint8Array | number> | undefined {
        const vIn = this.inputs[vIndex];
        const witnesses = vIn.transactionInWitness;
        if (!witnesses) {
            return;
        }

        const witness = witnesses[expectedPositionInWitness];
        if (!witness) return;

        const decoded = script.decompile(witness);
        if (!decoded) return;

        // this check is redundant now
        //if (Transaction.dataIncludeOPNetMagic(decoded)) {
        //    return decoded;
        //}

        return decoded;
    }

    protected parseInputs(vIn: VIn[]): void {
        for (let i = 0; i < vIn.length; i++) {
            this.inputs.push(new TransactionInput(vIn[i]));
        }
    }

    protected parseOutputs(vOuts: VOut[]): void {
        for (let i = 0; i < vOuts.length; i++) {
            this.outputs.push(new TransactionOutput(vOuts[i]));
        }
    }

    // ADDED: Compute the TapLeaf hash: leafVersion || varint(script.length) || script => taggedHash("TapLeaf", ...)
    private computeTapLeafHash(leafScript: Uint8Array, leafVersion: number): Uint8Array {
        // BIP341: leafVersion(1 byte) + varint(script.length) + script
        const varint = this.encodeVarint(leafScript.length);
        const toHash = concat([new Uint8Array([leafVersion]), varint, leafScript]);

        // "TapLeaf" tagged hash
        return this.taggedHash('TapLeaf', toHash);
    }

    // ADDED: replicate BIP341 "TapLeaf" or "TapSighash" tagged hashing
    private taggedHash(prefix: string, data: Uint8Array): Uint8Array {
        // This is the same approach as bip341, bip340, etc.
        const h1 = crypto.createHash('sha256').update(prefix).digest();
        const h2 = crypto.createHash('sha256').update(prefix).digest();

        const tagHash = concat([
            new Uint8Array(h1.buffer, h1.byteOffset, h1.byteLength),
            new Uint8Array(h2.buffer, h2.byteOffset, h2.byteLength),
        ]); // 64 bytes
        const result = crypto.createHash('sha256').update(tagHash).update(data).digest();
        return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
    }

    // ADDED: minimal varint encoder for script length
    private encodeVarint(num: number): Uint8Array {
        if (num < 0xfd) {
            return new Uint8Array([num]);
        } else if (num <= 0xffff) {
            const buf = new Uint8Array(3);
            buf[0] = 0xfd;
            buf[1] = num & 0xff;
            buf[2] = (num >> 8) & 0xff;
            return buf;
        } else if (num <= 0xffffffff) {
            const buf = new Uint8Array(5);
            buf[0] = 0xfe;
            buf[1] = num & 0xff;
            buf[2] = (num >> 8) & 0xff;
            buf[3] = (num >> 16) & 0xff;
            buf[4] = (num >> 24) & 0xff;
            return buf;
        } else {
            const buf = new Uint8Array(9);
            buf[0] = 0xff;
            const big = BigInt(num);
            for (let i = 0; i < 8; i++) {
                buf[1 + i] = Number((big >> BigInt(i * 8)) & 0xffn);
            }
            return buf;
        }
    }

    /**
     * BUILD A TAPROOT (SCRIPT-PATH) SIGHASH THAT OP_CHECKSIGVERIFY WOULD USE.
     * This replicates BIP341 SIGHASH_ALL for Tapscript path (no ANYPREVOUT, no annex).
     *
     * @param leafScript The Tapscript used
     * @param leafVersion The version (commonly 0xc0)
     * @param prevOutScript The scriptPubKey of the UTXO being spent
     * @param prevOutValue The value (satoshis) of that UTXO
     */
    private generateTapscriptSighashAll(
        leafScript: Uint8Array,
        leafVersion: number,
        prevOutScript: Uint8Array,
        prevOutValue: number,
    ): Uint8Array {
        // 1) parse the transaction from this.raw
        const txObj = BitcoinTransaction.fromBuffer(this.raw);

        // 2) build a leafHash for the Tapscript
        const leafHash = this.computeTapLeafHash(leafScript, leafVersion);

        // 3) we only do SIGHASH_ALL => hashType = 0x00
        const hashType = 0x00;

        // We must supply scriptPubKey & value for ALL inputs.
        // For demonstration, we fill out arrays of length txObj.ins.length,
        // with zero for everything except our vInputIndex.
        const nIn = txObj.ins.length;
        const emptyScript = new Uint8Array(0) as Script;
        const prevOutScripts = new Array<Script>(nIn).fill(emptyScript);
        const values = new Array<Satoshi>(nIn).fill(createSatoshi(0n));

        // fill our input with the real data
        prevOutScripts[this.vInputIndex] = prevOutScript as Script;
        values[this.vInputIndex] = createSatoshi(BigInt(prevOutValue));

        // 4) call hashForWitnessV1
        // -> If leafHash is provided, it's Tapscript path
        return txObj.hashForWitnessV1(
            this.vInputIndex,
            prevOutScripts,
            values,
            hashType,
            createBytes32(leafHash),
        );
    }

    private strToBuffer(str: string): Uint8Array {
        const writer = new BinaryWriter(str.length);
        writer.writeString(str);
        return writer.getBuffer();
    }

    private computeHashForTransaction(): Uint8Array {
        const hash = crypto.createHash('sha256');
        hash.update(this.transactionHash);
        hash.update(fromHex(this.blockHash));
        const result = hash.digest();
        return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
    }
}
