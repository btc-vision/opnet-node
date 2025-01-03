import { ScriptPubKey, TransactionData, VIn, VOut } from '@btc-vision/bsi-bitcoin-rpc';
import { DataConverter } from '@btc-vision/bsi-db';
import { Network, opcodes, script } from '@btc-vision/bitcoin';
import crypto from 'crypto';
import { Binary, Long } from 'mongodb';
import * as zlib from 'zlib';
import {
    ITransactionDocumentBasic,
    NetEventDocument,
    TransactionDocument,
} from '../../../db/interfaces/ITransactionDocument.js';
import { EvaluatedEvents, EvaluatedResult } from '../../../vm/evaluated/EvaluatedResult.js';
import { OPNetTransactionTypes } from './enums/OPNetTransactionTypes.js';
import { StrippedTransactionInput, TransactionInput } from './inputs/TransactionInput.js';
import { StrippedTransactionOutput, TransactionOutput } from './inputs/TransactionOutput.js';
import { Address, ChallengeGenerator } from '@btc-vision/transaction';
import { OPNetConsensus } from '../../../poa/configurations/OPNetConsensus.js';
import { OPNetHeader } from './interfaces/OPNetHeader.js';

const OPNet_MAGIC: Buffer = Buffer.from('op', 'utf-8');
const textEncoder = new TextEncoder();
const GZIP_HEADER: Buffer = Buffer.from([0x1f, 0x8b]);

export abstract class Transaction<T extends OPNetTransactionTypes> {
    public abstract readonly transactionType: T;

    public readonly inputs: TransactionInput[] = [];
    public readonly outputs: TransactionOutput[] = [];

    public readonly txid: string;
    public readonly raw: string;

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
    protected readonly transactionHashBuffer: Buffer;

    protected readonly transactionHash: string;
    protected readonly vInputIndex: number;

    protected receiptProofs: string[] | undefined;

    protected constructor(
        rawTransactionData: TransactionData,
        vInputIndex: number,
        blockHash: string,
        public readonly blockHeight: bigint,
        protected readonly network: Network,
    ) {
        if (rawTransactionData.blockhash && rawTransactionData.blockhash !== blockHash) {
            throw new Error(
                `Block hash mismatch: ${rawTransactionData.blockhash} !== ${blockHash}`,
            );
        }

        this.vInputIndex = vInputIndex;
        this.txid = rawTransactionData.txid;

        this.transactionHash = rawTransactionData.hash;
        this.transactionHashBuffer = Buffer.from(this.transactionHash, 'hex');

        this.raw = rawTransactionData.hex;
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

    public get strippedInputs(): StrippedTransactionInput[] {
        return this.inputs
            .slice(0, OPNetConsensus.consensus.TRANSACTIONS.MAXIMUM_INPUTS)
            .map((input) => input.toStripped());
    }

    public get strippedOutputs(): StrippedTransactionOutput[] {
        const outputs = this.outputs
            .slice(0, OPNetConsensus.consensus.TRANSACTIONS.MAXIMUM_OUTPUTS)
            .map((output) => output.toStripped());
        return outputs.filter((output): output is StrippedTransactionOutput => !!output);
    }

    public get computedIndexingHash(): Buffer {
        return this._computedIndexingHash;
    }

    protected _revert: Error | undefined;

    public get revert(): Error | undefined {
        return this._revert;
    }

    public set revert(error: Error) {
        this._revert = error;
    }

    public get revertBuffer(): Uint8Array | undefined {
        if (!this._revert) {
            return;
        }

        const finalMsg: string =
            this._revert.message.length > 1000
                ? this._revert.message.slice(0, 1000)
                : this._revert.message;

        return textEncoder.encode(finalMsg);
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
            throw new Error(`No sender address found for transaction ${this.txid}`);
        }

        return this._from;
    }

    // Position of transaction in the block
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

    // This represent OP_NET burned fees, priority fees, THIS IS NOT MINING FEES
    public get burnedFee(): bigint {
        return this._burnedFee;
    }

    protected _reward: bigint = 0n;

    public get reward(): bigint {
        return this._reward;
    }

    public get transactionId(): string {
        return this.txid;
    }

    public get hash(): string {
        return this.transactionHash;
    }

    public get bufferHash(): Buffer {
        return this.transactionHashBuffer;
    }

    public get gasUsed(): bigint {
        if (!this.receipt) {
            return 0n;
        }

        const receiptData: EvaluatedResult | undefined = this.receipt;
        return receiptData?.gasUsed || 0n;
    }

    public static verifyChecksum(scriptData: (number | Buffer)[], typeChecksum: Buffer): boolean {
        const checksum: Buffer = this.getDataChecksum(scriptData);

        return checksum.equals(typeChecksum);
    }

    public static dataIncludeOPNetMagic(data: Array<Buffer | number>): boolean {
        return data.some((value) => {
            if (typeof value === 'number') {
                return false;
            }

            const buffer: Buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
            if (buffer.byteLength !== OPNet_MAGIC.byteLength) {
                return false;
            }

            return buffer.equals(OPNet_MAGIC);
        });
    }

    public static decompressBuffer(buffer: Buffer): { out: Buffer; compressed: boolean } {
        if (!buffer) {
            throw new Error('Buffer is undefined. Can not decompress.');
        }

        const zlibHeader = buffer.subarray(0, 2);
        if (zlibHeader.equals(GZIP_HEADER)) {
            try {
                buffer = zlib.unzipSync(buffer, {
                    finishFlush: zlib.constants.Z_SYNC_FLUSH,
                    maxOutputLength: 1024 * 1024, // limit to 1mb no matter what.
                });
            } catch {
                throw new Error('OP_NET: Invalid compressed data.');
            }

            return { out: buffer, compressed: true };
        }

        return { out: buffer, compressed: false };
    }

    public static getDataFromScript(
        scriptData: Array<number | Buffer>,
        breakWhenReachOpcode: number = opcodes.OP_ELSE,
    ): Buffer | undefined {
        let data: Buffer | undefined = undefined;
        for (let i = 0; i < scriptData.length; i++) {
            if (scriptData[i] === breakWhenReachOpcode) {
                break;
            }

            if (Buffer.isBuffer(scriptData[i])) {
                if (!data) {
                    data = scriptData[i] as Buffer;
                } else {
                    data = Buffer.concat([data, scriptData[i] as Buffer]);
                }
            } else {
                throw new Error(`Invalid contract bytecode found in deployment transaction.`);
            }
        }

        return data;
    }

    protected static _is(data: TransactionData, typeChecksum: Buffer): number {
        let isCorrectType: number = -1;

        for (let y = 0; y < data.vin.length; y++) {
            const vIn = data.vin[y];
            const witnesses = vIn.txinwitness;

            if (!witnesses) {
                continue;
            }

            // always select the last witness that contains the magic
            for (let i = 0; i < witnesses.length; i++) {
                const witness = witnesses[i];
                const raw = Buffer.from(witness, 'hex');

                try {
                    const decodedScript = script.decompile(raw);
                    if (!decodedScript) continue;

                    const includeMagic = this.dataIncludeOPNetMagic(decodedScript);
                    if (!includeMagic) continue;

                    if (this.verifyChecksum(decodedScript, typeChecksum)) {
                        isCorrectType = y;
                        break;
                    }
                } catch {}
            }
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

    /** Decode an OP_NET header from the script data */
    protected static decodeOPNetHeader(
        scriptData: Array<number | Buffer>,
    ): OPNetHeader | undefined {
        const header = scriptData.shift();
        if (!Buffer.isBuffer(header) || header.length !== 4) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_TOALTSTACK) {
            return;
        }

        const preimage = scriptData.shift();
        if (
            !Buffer.isBuffer(preimage) ||
            preimage.length !== OPNetConsensus.consensus.POW.PREIMAGE_LENGTH
        ) {
            return;
        }

        if (scriptData.shift() !== opcodes.OP_TOALTSTACK) {
            return;
        }

        return new OPNetHeader(header, preimage);
    }

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
            raw: this.raw ? Buffer.from(this.raw, 'hex') : Buffer.alloc(0),
        };
    }

    public toDocument(): TransactionDocument<T> {
        const revertData: Uint8Array | undefined = this.revertBuffer;
        const inputDocuments = this.inputs.map((input: TransactionInput) => {
            return input.toDocument();
        });

        const outputDocuments = this.outputs.map((output) => output.toDocument());
        return {
            id: this.transactionId,
            hash: this.hash,
            blockHeight: DataConverter.toDecimal128(this.blockHeight),
            raw: this.raw ? Buffer.from(this.raw, 'hex') : Buffer.alloc(0),

            index: this.index,
            burnedBitcoin: DataConverter.toDecimal128(this.burnedFee),
            reward: new Long(this.reward),
            gasUsed: DataConverter.toDecimal128(
                this.receipt && this.receipt.gasUsed ? this.receipt.gasUsed : 0n,
            ),

            inputs: inputDocuments,

            outputs: outputDocuments,
            OPNetType: this.transactionType,

            revert: revertData ? new Binary(revertData) : undefined,
        };
    }

    public parseTransaction(vIn: VIn[], vOuts: VOut[]): void {
        this.parseInputs(vIn);
        this.parseOutputs(vOuts);
    }

    protected verifyRewardUTXO(): void {
        if (!this._preimage) {
            throw new Error('Preimage not found');
        }

        // Reward output should always be the second output.
        const rewardOutput = this.outputs[1];
        if (!rewardOutput) {
            return; // even if the user dont include the reward, this will revert due to out of gas
        }

        const rewardChallenge = ChallengeGenerator.generateMineableReward(
            this.preimage,
            this.network,
        );

        if (rewardOutput.scriptPubKey.address !== rewardChallenge.address) {
            throw new Error('Invalid reward output address');
        }

        this.setReward(rewardOutput);
    }

    /**
     * Convert the events to the document format.
     * @param events NetEvent[]
     * @protected
     */
    protected convertEvents(events: EvaluatedEvents | undefined): NetEventDocument[] {
        if (!events) {
            return [];
        }

        const netEvents: NetEventDocument[] = [];
        for (const [contractAddress, contractEvents] of events) {
            for (const event of contractEvents) {
                netEvents.push({
                    contractAddress: contractAddress,
                    data: new Binary(event.data),
                    type: event.type,
                });
            }
        }

        return netEvents;
    }

    protected decompressData(buffer: Buffer): Buffer {
        const decompressed = Transaction.decompressBuffer(buffer);
        if (decompressed.compressed) {
            this.wasCompressed = true;
        }

        return decompressed.out;
    }

    protected getWitnessOutput(originalContractAddress: string): TransactionOutput {
        const contractOutput = this.outputs.find((output): boolean => {
            if (output.scriptPubKey.address) {
                return output.scriptPubKey.address === originalContractAddress;
            }

            return false;
        });

        if (!contractOutput) {
            throw new Error(`Could not find the requested output for ${originalContractAddress}`);
        }

        return contractOutput;
    }

    protected setBurnedFee(witnessOutput: TransactionOutput): void {
        const scriptPubKey: ScriptPubKey = witnessOutput.scriptPubKey;
        if (!scriptPubKey.address) {
            throw new Error('No address found for contract witness output');
        }

        // We set fees sent to the target witness as burned fees
        this._burnedFee = witnessOutput.value;

        if (this._burnedFee > 2000n) {
            throw new Error('Burned too much fee');
        }
    }

    protected setReward(output: TransactionOutput): void {
        this._reward = output.value;
    }

    /**
     * Verify if the magic is present in the witness and return the witness with the magic.
     * @param vIndex
     * @protected
     */
    protected getWitnessWithMagic(
        vIndex: number = this.vInputIndex,
    ): Array<Buffer | number> | undefined {
        const vIn = this.inputs[vIndex];
        const witnesses = vIn.transactionInWitness;

        for (let i = 0; i < witnesses.length; i++) {
            const witness = witnesses[i];
            const raw = Buffer.from(witness, 'hex');

            const decodedScript = script.decompile(raw);
            if (!decodedScript) continue;

            const includeMagic = Transaction.dataIncludeOPNetMagic(decodedScript);
            if (!includeMagic) continue;

            return decodedScript;
        }
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

    private computeHashForTransaction(): Buffer {
        // Create a hash from the transaction hash and the block hash
        const hash = crypto.createHash('sha256');
        hash.update(this.bufferHash);
        hash.update(Buffer.from(this.blockHash, 'hex'));
        return hash.digest();
    }
}
