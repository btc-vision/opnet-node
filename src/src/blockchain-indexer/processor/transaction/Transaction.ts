import { ScriptPubKey, TransactionData, VIn, VOut } from '@btc-vision/bsi-bitcoin-rpc';
import { DataConverter } from '@btc-vision/bsi-db';
import { Network, opcodes, script } from 'bitcoinjs-lib';
import crypto from 'crypto';
import { Binary } from 'mongodb';
import * as zlib from 'zlib';
import {
    ITransactionDocumentBasic,
    TransactionDocument,
} from '../../../db/interfaces/ITransactionDocument.js';
import { EvaluatedResult } from '../../../vm/evaluated/EvaluatedResult.js';
import { OPNetTransactionTypes } from './enums/OPNetTransactionTypes.js';
import { TransactionInput } from './inputs/TransactionInput.js';
import { TransactionOutput } from './inputs/TransactionOutput.js';
import { VaultInput, VaultInputDecoder } from '../vault/VaultInputDecoder.js';
import { ICompromisedTransactionDocument } from '../../../db/interfaces/CompromisedTransactionDocument.js';

const OPNet_MAGIC: Buffer = Buffer.from('bsi', 'utf-8');
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
    protected readonly _authorizedVaultUsage: boolean = false;

    private readonly vaultDecoder: VaultInputDecoder = new VaultInputDecoder();

    readonly #vaultInputs: VaultInput[] = [];

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
        this.inActiveChain = rawTransactionData.in_active_chain;

        this.size = rawTransactionData.size;
        this.vSize = rawTransactionData.vsize;
        this.weight = rawTransactionData.weight;

        this.version = rawTransactionData.version;
        this.lockTime = rawTransactionData.locktime;

        this.blockHash = blockHash;
        this.confirmations = rawTransactionData.confirmations;

        this.blockTime = rawTransactionData.blocktime;
        this.time = rawTransactionData.time;

        this._computedIndexingHash = this.computeHashForTransaction();
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

    public get authorizedVaultUsage(): boolean {
        return this._authorizedVaultUsage;
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

    public get vaultInputs(): VaultInput[] {
        return this.#vaultInputs;
    }

    protected _from: string | undefined;

    public get from(): string {
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

    /*public get originalIndex(): number {
        return this._originalIndex;
    }*/

    public set originalIndex(index: number) {
        this._originalIndex = index;
    }

    protected _burnedFee: bigint = 0n;

    // This represent OP_NET burned fees, priority fees, THIS IS NOT MINING FEES
    public get burnedFee(): bigint {
        return this._burnedFee;
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
            buffer = zlib.unzipSync(buffer, {
                finishFlush: zlib.constants.Z_SYNC_FLUSH,
                maxOutputLength: 1024 * 1024 * 16, // limit to 16mb no matter what.
            });

            return { out: buffer, compressed: true };
        }

        return { out: buffer, compressed: false };
    }

    public static getDataFromWitness(
        scriptData: Array<number | Buffer>,
        breakWhenReachOpcode: number = opcodes.OP_ELSE,
    ): Buffer | undefined {
        let contractBytecode: Buffer | undefined = undefined;
        for (let i = 0; i < scriptData.length; i++) {
            if (scriptData[i] === breakWhenReachOpcode) {
                break;
            }

            if (Buffer.isBuffer(scriptData[i])) {
                if (!contractBytecode) {
                    contractBytecode = scriptData[i] as Buffer;
                } else {
                    contractBytecode = Buffer.concat([contractBytecode, scriptData[i] as Buffer]);
                }
            } else {
                throw new Error(`Invalid contract bytecode found in deployment transaction.`);
            }
        }

        return contractBytecode;
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
                } catch (e) {}
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

    public getCompromisedDocument(): ICompromisedTransactionDocument {
        return {
            id: this.transactionId,
            height: this.blockHeight,

            compromisedAuthorities: this.vaultInputs,
        };
    }

    public toBitcoinDocument(): ITransactionDocumentBasic<T> {
        const outputDocuments = this.outputs.map((output) => output.toDocument());

        return {
            id: this.transactionId,
            hash: this.hash,
            blockHeight: DataConverter.toDecimal128(this.blockHeight),

            index: this.index,

            inputs: this.inputs.map((input) => {
                return {
                    originalTransactionId: input.originalTransactionId,
                    outputTransactionIndex: input.outputTransactionIndex,
                    sequenceId: input.sequenceId,
                    transactionInWitness: input.transactionInWitness,
                };
            }),
            outputs: outputDocuments,

            OPNetType: this.transactionType,
        };
    }

    public toDocument(): TransactionDocument<T> {
        const revertData: Uint8Array | undefined = this.revertBuffer;
        const outputDocuments = this.outputs.map((output) => output.toDocument());

        return {
            id: this.transactionId,
            hash: this.hash,
            blockHeight: DataConverter.toDecimal128(this.blockHeight),

            index: this.index,
            burnedBitcoin: DataConverter.toDecimal128(this.burnedFee),
            gasUsed: DataConverter.toDecimal128(
                this.receipt && this.receipt.gasUsed ? this.receipt.gasUsed : 0n,
            ),

            inputs: this.inputs.map((input) => {
                return {
                    originalTransactionId: input.originalTransactionId,
                    outputTransactionIndex: input.outputTransactionIndex,
                    sequenceId: input.sequenceId,
                    transactionInWitness: input.transactionInWitness,
                };
            }),
            outputs: outputDocuments,

            OPNetType: this.transactionType,

            revert: revertData ? new Binary(revertData) : undefined,
        };
    }

    public parseTransaction(vIn: VIn[], vOuts: VOut[]): void {
        this.parseInputs(vIn);
        this.parseOutputs(vOuts);

        this.decodeVaults();
    }

    /** We must verify every single transaction and decode any vault inputs */
    protected decodeVaults(): void {
        for (const input of this.inputs) {
            const vault = this.vaultDecoder.decodeInput(input);
            if (!vault) {
                continue;
            }

            this.#vaultInputs.push(vault);
        }
    }

    protected decompressData(buffer: Buffer | undefined): Buffer {
        if (!buffer) {
            throw new Error('Buffer is undefined. Can not decompress.');
        }

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

        if (
            !(
                scriptPubKey.type === 'witness_v1_taproot' ||
                scriptPubKey.type === 'witness_v0_keyhash'
            )
        ) {
            throw new Error(
                `Invalid scriptPubKey type for contract witness output. Was ${scriptPubKey.type}`,
            );
        }

        if (!scriptPubKey.address) {
            throw new Error('No address found for contract witness output');
        }

        // We set fees sent to the target witness as burned fees
        this._burnedFee = witnessOutput.value;
    }

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
