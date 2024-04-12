import { Logger } from '@btc-vision/motoswapcommon';
import { PsbtInput, PsbtOutput } from 'bip174/src/lib/interfaces.js';
import { networks, Payment, payments, Psbt, Signer, Transaction } from 'bitcoinjs-lib';
import { Network } from 'bitcoinjs-lib/src/networks.js';
import { TransactionInput } from 'bitcoinjs-lib/src/psbt.js';
import { toXOnly } from 'bitcoinjs-lib/src/psbt/bip371.js';

import { ECPairInterface } from 'ecpair';
import { Vout } from '../blockchain-indexer/rpc/types/BitcoinRawTransaction.js';

export interface TapLeafScript {
    leafVersion: number;
    controlBlock: Buffer;
    script: Buffer;
}

export interface UpdateInput {
    tapLeafScript: TapLeafScript[];
}

export interface ITransaction {
    readonly from: string;

    readonly calldata?: Buffer;
    readonly value: bigint;

    readonly txid: string;
    readonly vout: Vout;
}

export interface PsbtInputExtended extends PsbtInput, TransactionInput {}

export interface PsbtOutputExtendedAddress extends PsbtOutput {
    address: string;
    value: number;
}

export interface PsbtOutputExtendedScript extends PsbtOutput {
    script: Buffer;
    value: number;
}

export type PsbtOutputExtended = PsbtOutputExtendedAddress | PsbtOutputExtendedScript;

export abstract class BSCTransaction extends Logger {
    protected static readonly MINIMUM_DUST: bigint = 330n;

    public readonly logColor: string = '#785def';
    protected readonly transaction: Psbt;

    protected readonly inputs: PsbtInputExtended[] = [];
    protected readonly updateInputs: UpdateInput[] = [];

    protected readonly outputs: PsbtOutputExtended[] = [];

    protected feeOutput: PsbtOutputExtended | null = null;
    protected signed: boolean = false;

    protected tapData: Payment | null = null;
    protected scriptData: Payment | null = null;

    protected constructor(
        protected readonly data: ITransaction,
        protected readonly salt: ECPairInterface,
        protected readonly network: Network = networks.bitcoin,
        protected readonly feeRate: number = 1,
    ) {
        super();

        if (!this.salt.privateKey) {
            throw new Error('Private key is required');
        }

        if (this.btcToSatoshi(this.data.vout.value) < this.data.value) {
            throw new Error(`Vout value is less than the value to send`);
        }

        if (this.data.value < BSCTransaction.MINIMUM_DUST) {
            throw new Error(`Value is less than the minimum dust`);
        }

        this.transaction = new Psbt({
            network: this.network,
        });
    }

    public signTransaction(contractAddress: string = this.getScriptAddress()): string | null {
        if (this.signed) throw new Error('Transaction is already signed');
        this.signed = true;

        this.buildTransaction(contractAddress);

        const builtTx = this.internalBuildTransaction(this.transaction);

        if (builtTx) {
            return this.transaction.extractTransaction(false).toHex();
        }

        return null;
    }

    public getTransaction(): Transaction {
        return this.transaction.extractTransaction(false);
    }

    public abstract requestUTXO(): Promise<void>;

    public getScriptAddress(): string {
        if (!this.scriptData || !this.scriptData.address) {
            throw new Error('Tap data is required');
        }

        return this.scriptData.address;
    }

    public getTapAddress(): string {
        if (!this.tapData || !this.tapData.address) {
            throw new Error('Tap data is required');
        }

        return this.tapData.address;
    }

    protected internalInit(): void {
        this.verifyTapAddress();

        //console.log(this.generateTapData(), this.generateScriptAddress());

        this.scriptData = payments.p2tr(this.generateScriptAddress());
        this.tapData = payments.p2tr(this.generateTapData());
    }

    protected abstract buildTransaction(to?: string): void;

    protected generateScriptAddress(): Payment {
        return {
            internalPubkey: this.internalPubKeyToXOnly(),
            network: this.network,
        };
    }

    protected generateTapData(): Payment {
        return {
            internalPubkey: this.internalPubKeyToXOnly(),
            network: this.network,
        };
    }

    protected updateInput(input: UpdateInput): void {
        this.updateInputs.push(input);
    }

    protected btcToSatoshi(btc: number): bigint {
        return BigInt(btc * 100000000);
    }

    protected getWitness(): Buffer {
        if (!this.tapData || !this.tapData.witness) {
            throw new Error('Witness is required');
        }

        if (this.tapData.witness.length === 0) {
            throw new Error('Witness is empty');
        }

        return this.tapData.witness[this.tapData.witness.length - 1];
    }

    protected getTapOutput(): Buffer {
        if (!this.tapData || !this.tapData.output) {
            throw new Error('Tap data is required');
        }

        return this.tapData.output;
    }

    protected getInputs(): PsbtInputExtended[] {
        return this.inputs;
    }

    protected getOutputs(): PsbtOutputExtended[] {
        if (!this.feeOutput) throw new Error('Fee output is required');

        const outputs: PsbtOutputExtended[] = [...this.outputs];
        outputs.push(this.feeOutput);

        return outputs;
    }

    protected verifyTapAddress(): void {
        if (!this.data.vout.scriptPubKey) {
            throw new Error('Address is required');
        }
    }

    protected setFeeOutput(output: PsbtOutputExtended): void {
        this.feeOutput = output;

        const fee = this.estimateTransactionFees();
        if (fee > BigInt(output.value)) {
            throw new Error('Insufficient funds');
        }

        this.feeOutput.value = this.feeOutput.value - Number(fee);
    }

    protected addInput(input: PsbtInputExtended): void {
        this.inputs.push(input);
    }

    protected addOutput(output: PsbtOutputExtended): void {
        this.outputs.push(output);
    }

    protected abstract getSignerKey(): Signer;

    protected internalPubKeyToXOnly(): Buffer {
        return toXOnly(this.salt.publicKey);
    }

    private internalBuildTransaction(transaction: Psbt): boolean {
        const inputs: PsbtInputExtended[] = this.getInputs();
        const outputs: PsbtOutputExtended[] = this.getOutputs();

        transaction.setMaximumFeeRate(1000000);
        transaction.addInputs(inputs);

        for (let i = 0; i < this.updateInputs.length; i++) {
            transaction.updateInput(i, this.updateInputs[i]);
        }

        transaction.addOutputs(outputs);

        try {
            transaction.signAllInputs(this.getSignerKey());
            transaction.finalizeAllInputs();

            const usedFee = transaction.getFee();
            this.log(`Transaction fee: ${usedFee} - ${transaction.getFeeRate()}`);

            return true;
        } catch (e) {
            const err: Error = e as Error;

            this.error(
                `Something went wrong while getting building the transaction: ${err.message}`,
            );
        }

        return false;
    }

    private estimateTransactionFees(): bigint {
        const fakeTx = new Psbt({
            network: this.network,
        });

        const builtTx = this.internalBuildTransaction(fakeTx);

        if (builtTx) {
            const tx = fakeTx.extractTransaction(false);
            const size = tx.virtualSize();
            const fee: number = this.feeRate * size + 1;

            this.log(`Transaction fee estimated to: ${fee} - ${fakeTx.getFeeRate()}`);

            return BigInt(Math.ceil(fee));
        } else {
            throw new Error(
                `Could not build transaction to estimate fee. Something went wrong while building the transaction.`,
            );
        }
    }
}
