import { ScriptPubKey, TransactionData, VIn, VOut } from '@btc-vision/bsi-bitcoin-rpc';
import bitcoin, { opcodes, script } from 'bitcoinjs-lib';
import crypto from 'crypto';
import * as zlib from 'zlib';
import { OPNetTransactionTypes } from './enums/OPNetTransactionTypes.js';
import { TransactionInput } from './inputs/TransactionInput.js';
import { TransactionOutput } from './inputs/TransactionOutput.js';

const OPNet_MAGIC: Buffer = Buffer.from('bsi', 'utf-8');

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

    public readonly computedIndexingHash: Buffer;

    protected readonly transactionHashBuffer: Buffer;
    protected readonly transactionHash: string;

    protected readonly vInputIndex: number;
    protected wasCompressed: boolean = false;

    protected constructor(
        rawTransactionData: TransactionData,
        vInputIndex: number,
        blockHash: string,
        protected readonly network: bitcoin.networks.Network,
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

        this.computedIndexingHash = this.computeHashForTransaction();
        this.parseTransaction(rawTransactionData.vin, rawTransactionData.vout);
    }

    protected _burnedFee: bigint = this.rndBigInt(0, 1000);

    // This represent OP_NET burned fees, priority fees, THIS IS NOT MINING FEES
    public get burnedFee(): bigint {
        return this._burnedFee; //+ this.rndBigInt(0, 1000);
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

    protected static getDataChecksum(data: Array<Buffer | number>): Buffer {
        let checksum: number[] = [];

        for (let i = 0; i < data.length; i++) {
            if (typeof data[i] === 'number') {
                checksum.push(data[i] as number);
            }
        }

        return Buffer.from(checksum);
    }

    protected static verifyChecksum(
        scriptData: (number | Buffer)[],
        typeChecksum: Buffer,
    ): boolean {
        const checksum: Buffer = this.getDataChecksum(scriptData);

        return checksum.equals(typeChecksum);
    }

    protected static _is(data: TransactionData, typeChecksum: Buffer): number {
        let isCorrectType: number = -1;

        for (let y = 0; y < data.vin.length; y++) {
            const vIn = data.vin[y];
            const witnesses = vIn.txinwitness;

            for (let i = 0; i < witnesses.length; i++) {
                const witness = witnesses[i];
                const raw = Buffer.from(witness, 'hex');

                const decodedScript = script.decompile(raw);
                if (!decodedScript) continue;

                const includeMagic = this.dataIncludeOPNetMagic(decodedScript);
                if (!includeMagic) continue;

                if (this.verifyChecksum(decodedScript, typeChecksum)) {
                    isCorrectType = y;
                    break;
                }
            }
        }

        return isCorrectType;
    }

    protected static dataIncludeOPNetMagic(data: Array<Buffer | number>): boolean {
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

    protected decompressData(buffer: Buffer | undefined): Buffer {
        if (!buffer) {
            throw new Error('Buffer is undefined. Can not decompress.');
        }

        const zlibHeader = buffer.slice(0, 2);
        if (zlibHeader.equals(Buffer.from([0x1f, 0x8b]))) {
            buffer = zlib.unzipSync(buffer);

            this.wasCompressed = true;
        }

        return buffer;
    }

    protected decimalOutputToBigInt(output: number): bigint {
        return BigInt(output * 100000000);
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

        if (scriptPubKey.type !== 'witness_v1_taproot') {
            throw new Error('Invalid scriptPubKey type for contract witness output');
        }

        if (!scriptPubKey.address) {
            throw new Error('No address found for contract witness output');
        }

        // We set fees sent to the target witness as burned fees
        this._burnedFee = this.decimalOutputToBigInt(witnessOutput.value);
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

    protected parseTransaction(vIn: VIn[], vOuts: VOut[]): void {
        this.parseInputs(vIn);
        this.parseOutputs(vOuts);
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

    protected getDataFromWitness(scriptData: Array<number | Buffer>): Buffer | undefined {
        let contractBytecode: Buffer | undefined = undefined;
        for (let i = 0; i < scriptData.length; i++) {
            if (scriptData[i] === opcodes.OP_ELSE) {
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

    private computeHashForTransaction(): Buffer {
        // Create a hash from the transaction hash and the block hash
        const hash = crypto.createHash('sha256');
        hash.update(this.bufferHash);
        hash.update(Buffer.from(this.blockHash, 'hex'));
        return hash.digest();
    }

    private rndBigInt(min: number, max: number): bigint {
        return BigInt(Math.floor(Math.random() * (max - min + 1) + min));
    }
}
