import { TransactionData, VIn, VOut } from '@btc-vision/bsi-bitcoin-rpc';
import crypto from 'crypto';
import { OPNetTransactionTypes } from './enums/OPNetTransactionTypes.js';
import { TransactionInput } from './inputs/TransactionInput.js';
import { TransactionOutput } from './inputs/TransactionOutput.js';

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

    protected constructor(rawTransactionData: TransactionData, blockHash: string) {
        if (rawTransactionData.blockhash && rawTransactionData.blockhash !== blockHash) {
            throw new Error(
                `Block hash mismatch: ${rawTransactionData.blockhash} !== ${blockHash}`,
            );
        }

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

    protected _miningFee: bigint = 0n;

    // Don't use for sorting, use burnedFee instead
    public get miningFee(): bigint {
        return this._miningFee;
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

    // To know how much a transaction spent in fees, we need to calculate the difference between the inputs and outputs
    /*protected calculateMinerFees(): void {
        this._miningFee =
            this.inputs.reduce((acc: bigint, input: TransactionInput) => {
                return acc + input.value;
            }, 0n) - this.outputs.reduce((acc, output) => acc + output.value, 0n);
    }*/

    /*public get fee(): bigint {
        return this.inputs.reduce((acc, input) => acc + input.value, 0n) - this.outputs.reduce((acc, output) => acc + output.value, 0n);
    }*/
}
