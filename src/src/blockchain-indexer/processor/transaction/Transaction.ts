import { TransactionData, VIn, VOut } from '@btc-vision/bitcoin-rpc';
import { DataConverter } from '@btc-vision/bsi-db';
import { Network, script, Transaction as BitcoinTransaction } from '@btc-vision/bitcoin';
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
import { OPNetConsensus } from '../../../poa/configurations/OPNetConsensus.js';
import { OPNetHeader } from './interfaces/OPNetHeader.js';
import * as ecc from 'tiny-secp256k1';
import { AddressCache } from '../AddressCache.js';

export const OPNet_MAGIC: Buffer = Buffer.from('op', 'utf-8');
const GZIP_HEADER: Buffer = Buffer.from([0x1f, 0x8b]);

// We need ECDSA/ECC functionality:
if (!ecc.isPoint(Buffer.alloc(33, 2))) {
    throw new Error('tiny-secp256k1 initialization check failed');
}

export abstract class Transaction<T extends OPNetTransactionTypes> {
    public abstract readonly transactionType: T;

    public readonly inputs: TransactionInput[] = [];
    public readonly outputs: TransactionOutput[] = [];

    public readonly txidHex: string;
    public readonly raw: Buffer;

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

    protected readonly _computedIndexingHash: Buffer;
    protected readonly transactionHash: Buffer;
    protected readonly vInputIndex: number;
    protected receiptProofs: string[] | undefined;

    private readonly txid: Buffer;

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

        this.txid = Buffer.from(rawTransactionData.txid, 'hex');
        this.txidHex = rawTransactionData.txid;
        this.transactionHash = Buffer.from(rawTransactionData.hash, 'hex');
        this.raw = rawTransactionData.hex
            ? Buffer.from(rawTransactionData.hex, 'hex')
            : Buffer.alloc(0);

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

    protected _preimage: Buffer | undefined;
    public get preimage(): Buffer {
        const preimage = Buffer.alloc(this._preimage?.length || 0);
        if (this._preimage) {
            this._preimage.copy(preimage);
        }
        return preimage;
    }

    protected _miner: Buffer | undefined;
    public get miner(): Buffer {
        const preimage = Buffer.alloc(this._miner?.length || 0);
        if (this._miner) {
            this._miner.copy(preimage);
        }
        return preimage;
    }

    public get strippedInputs(): StrippedTransactionInput[] {
        return this.inputs
            .slice(0, OPNetConsensus.consensus.VM.UTXOS.MAXIMUM_INPUTS)
            .map((input) => input.toStripped());
    }

    public get strippedOutputs(): StrippedTransactionOutput[] {
        const outputs = this.outputs
            .slice(0, OPNetConsensus.consensus.VM.UTXOS.MAXIMUM_OUTPUTS)
            .map((output) => output.toStripped());

        return outputs.filter((output): output is StrippedTransactionOutput => !!output);
    }

    public get computedIndexingHash(): Buffer {
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

    public get transactionId(): Buffer {
        return this.txid;
    }

    public get transactionIdString(): string {
        return this.txidHex;
    }

    public get hash(): Buffer {
        return this.transactionHash;
    }

    public get totalGasUsed(): bigint {
        if (!this._receipt) return 0n;

        return (this._receipt.gasUsed || 0n) + (this._receipt.specialGasUsed || 0n);
    }

    // Simple check for presence of OPNet magic
    public static dataIncludeOPNetMagic(data: Array<Buffer | number>): boolean {
        return data.some((value) => {
            if (typeof value === 'number') return false;
            const buffer: Buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
            if (buffer.byteLength !== OPNet_MAGIC.byteLength) return false;
            return buffer.equals(OPNet_MAGIC);
        });
    }

    public static verifyChecksum(scriptData: (number | Buffer)[], typeChecksum: Buffer): boolean {
        const checksum: Buffer = this.getDataChecksum(scriptData);
        return checksum.equals(typeChecksum);
    }

    public static decompressBuffer(buffer: Buffer): { out: Buffer; compressed: boolean } {
        if (!buffer) {
            throw new Error('Buffer is undefined. Cannot decompress.');
        }
        const zlibHeader = buffer.subarray(0, 2);
        if (zlibHeader.equals(GZIP_HEADER)) {
            try {
                buffer = zlib.unzipSync(buffer, {
                    finishFlush: zlib.constants.Z_SYNC_FLUSH,
                    maxOutputLength: OPNetConsensus.consensus.COMPRESSION.MAX_DECOMPRESSED_SIZE,
                });
            } catch {
                throw new Error('OP_NET: Invalid compressed data.');
            }
            return { out: buffer, compressed: true };
        }
        return { out: buffer, compressed: false };
    }

    protected static _is(data: TransactionData, typeChecksum: Buffer): number {
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
            const rawScriptBuf = Buffer.from(rawScriptHex, 'hex');

            let decodedScript: (number | Buffer)[] | null;
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

    protected static getDataChecksum(data: Array<Buffer | number>): Buffer {
        const checksum: number[] = [];
        for (let i = 0; i < data.length; i++) {
            if (typeof data[i] === 'number') {
                checksum.push(data[i] as number);
            }
        }
        return Buffer.from(checksum);
    }

    public setMiner(miner: Buffer, preimage: Buffer) {
        this.verifyPreImage(new Address(miner), preimage);

        this._preimage = preimage;
        this._miner = miner;
    }

    public verifyPreImage: (miner: Address, preimage: Buffer) => void = (
        _miner: Address,
        _preimage: Buffer,
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
        senderPubKey: Buffer,
        senderSig: Buffer,
        leafScript: Buffer,
        leafVersion: number,
        prevOutScript: Buffer,
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

        let xOnlyPub: Buffer;
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

    protected verifyRewardUTXO(): void {
        if (!this._preimage) {
            throw new Error('Preimage not found');
        }

        const rewardOutput = this.outputs[1];
        if (!rewardOutput) {
            return; // no reward output
        }

        if (
            !rewardOutput.scriptPubKey.address ||
            rewardOutput.scriptPubKey.type !== 'witness_v0_scripthash'
        ) {
            return; // reward output must be a P2SH address
        }

        const rewardChallenge = TimeLockGenerator.generateTimeLockAddress(
            this.miner,
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
    ): Array<Buffer | number> | undefined {
        const vIn = this.inputs[vIndex];
        const witnesses = vIn.transactionInWitness;
        if (!witnesses) {
            return;
        }

        const witnessHex = witnesses[expectedPositionInWitness];
        if (!witnessHex) return;

        const raw = Buffer.from(witnessHex, 'hex');
        const decoded = script.decompile(raw);
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
    private computeTapLeafHash(leafScript: Buffer, leafVersion: number): Buffer {
        // BIP341: leafVersion(1 byte) + varint(script.length) + script
        const varint = this.encodeVarint(leafScript.length);
        const toHash = Buffer.concat([Buffer.from([leafVersion]), varint, leafScript]);

        // "TapLeaf" tagged hash
        return this.taggedHash('TapLeaf', toHash);
    }

    // ADDED: replicate BIP341 "TapLeaf" or "TapSighash" tagged hashing
    private taggedHash(prefix: string, data: Buffer): Buffer {
        // This is the same approach as bip341, bip340, etc.
        const h1 = crypto.createHash('sha256').update(prefix).digest();
        const h2 = crypto.createHash('sha256').update(prefix).digest();

        const tagHash = Buffer.concat([h1, h2]); // 64 bytes
        return crypto.createHash('sha256').update(tagHash).update(data).digest();
    }

    // ADDED: minimal varint encoder for script length
    private encodeVarint(num: number): Buffer {
        if (num < 0xfd) {
            return Buffer.from([num]);
        } else if (num <= 0xffff) {
            const buf = Buffer.alloc(3);
            buf[0] = 0xfd;
            buf.writeUInt16LE(num, 1);
            return buf;
        } else if (num <= 0xffffffff) {
            const buf = Buffer.alloc(5);
            buf[0] = 0xfe;
            buf.writeUInt32LE(num, 1);
            return buf;
        } else {
            const buf = Buffer.alloc(9);
            buf[0] = 0xff;
            buf.writeBigUInt64LE(BigInt(num), 1);
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
        leafScript: Buffer,
        leafVersion: number,
        prevOutScript: Buffer,
        prevOutValue: number,
    ): Buffer {
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
        const prevOutScripts = new Array<Buffer>(nIn).fill(Buffer.alloc(0));
        const values = new Array<number>(nIn).fill(0);

        // fill our input with the real data
        prevOutScripts[this.vInputIndex] = prevOutScript;
        values[this.vInputIndex] = prevOutValue;

        // 4) call hashForWitnessV1
        // -> If leafHash is provided, it's Tapscript path
        return txObj.hashForWitnessV1(this.vInputIndex, prevOutScripts, values, hashType, leafHash);
    }

    private strToBuffer(str: string): Uint8Array {
        const writer = new BinaryWriter(str.length);
        writer.writeString(str);
        return writer.getBuffer();
    }

    private computeHashForTransaction(): Buffer {
        const hash = crypto.createHash('sha256');
        hash.update(this.transactionHash);
        hash.update(Buffer.from(this.blockHash, 'hex'));
        return hash.digest();
    }
}
