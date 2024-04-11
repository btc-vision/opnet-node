import { Logger } from '@btc-vision/motoswapcommon';
import { Buff } from '@cmdcode/buff-utils';
import { PsbtInput, PsbtOutput } from 'bip174/src/lib/interfaces.js';
import { networks, Payment, payments, Psbt, Signer, Transaction } from 'bitcoinjs-lib';
import { Network } from 'bitcoinjs-lib/src/networks.js';
import { TransactionInput } from 'bitcoinjs-lib/src/psbt.js';
import { toXOnly } from 'bitcoinjs-lib/src/psbt/bip371.js';

import { ECPairInterface } from 'ecpair';
import { Vout } from '../blockchain-indexer/rpc/types/BitcoinRawTransaction.js';
import { BitcoinHelper } from './BitcoinHelper.js';

export interface ITransaction {
    readonly from: string;
    readonly to: string;

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

export class BSCTransaction extends Logger {
    protected static readonly MINIMUM_DUST: bigint = 330n;

    public readonly logColor: string = '#785def';
    protected readonly transaction: Psbt;

    protected readonly inputs: PsbtInputExtended[] = [];
    protected readonly outputs: PsbtOutputExtended[] = [];

    protected readonly tweakedSigner: Signer;

    protected feeOutput: PsbtOutputExtended | null = null;
    protected signed: boolean = false;

    protected tapData: Payment | null = null;

    public constructor(
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

        this.tweakedSigner = this.getTweakedSigner();
        this.generateTapAddress();

        this.transaction = new Psbt({
            network: this.network,
        });

        this.buildTransaction();
    }

    public static generateTapAddress(salt: ECPairInterface, network: Network): string {
        const tweakedSigner = BitcoinHelper.tweakSigner(salt, {
            network,
        });

        const addr = payments.p2tr({
            pubkey: toXOnly(tweakedSigner.publicKey),
            network,
        }).address;

        if (!addr) {
            throw new Error('Failed to generate tap address');
        }

        return addr;
    }

    public signTransaction(): string | null {
        if (this.signed) throw new Error('Transaction is already signed');
        this.signed = true;

        const inputs: PsbtInputExtended[] = this.getInputs();
        const outputs: PsbtOutputExtended[] = this.getOutputs();

        this.transaction.setMaximumFeeRate(1000000);
        this.transaction.addInputs(inputs);
        this.transaction.addOutputs(outputs);

        try {
            this.transaction.signAllInputs(this.getSignerKey());
            this.transaction.finalizeAllInputs();

            const usedFee = this.transaction.getFee();
            this.log(`Transaction fee: ${usedFee} - ${this.transaction.getFeeRate()}`);

            return this.transaction.extractTransaction(false).toHex();
        } catch (e) {
            const err: Error = e as Error;

            this.error(
                `Something went wrong while getting building the transaction: ${err.message}`,
            );
        }

        return null;
    }

    public getTransaction(): Transaction {
        return this.transaction.extractTransaction(false);
    }

    protected btcToSatoshi(btc: number): bigint {
        return BigInt(btc * 100000000);
    }

    protected getTapAddress(): string {
        if (!this.tapData || !this.tapData.address) {
            throw new Error('Tap data is required');
        }

        return this.tapData.address;
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

    protected getPubKeyXOnly(): Buffer {
        return toXOnly(this.tweakedSigner.publicKey);
    }

    protected verifyTapAddress(): void {
        //const tapAddress = this.getTapAddress();

        /*if (tapAddress.address !== this.data.from) {
            throw new Error(
                `The specified address is not equal to the generated taproot address. (Generated: ${tapAddress.address}, Specified: ${this.data.from})`,
            );
        }*/

        if (!this.data.vout.scriptPubKey) {
            throw new Error('Address is required');
        }
    }

    protected setFeeOutput(output: PsbtOutputExtended): void {
        this.feeOutput = output;

        const fee = this.getTransactionFee();
        if (fee > BigInt(output.value)) {
            throw new Error('Insufficient funds');
        }

        this.feeOutput.value = this.feeOutput.value - Number(fee);
    }

    protected buildTransaction(): void {
        this.verifyTapAddress();

        this.addInput({
            hash: this.data.txid,
            index: this.data.vout.n,
            witnessUtxo: {
                value: Number(this.data.value),
                script: this.getTapOutput(),
            },
            tapInternalKey: this.getTapPubKeyXOnly(),
        });

        const sendAmount: bigint = this.data.value - BSCTransaction.MINIMUM_DUST;
        this.addOutput({
            value: Number(BSCTransaction.MINIMUM_DUST),
            address: this.data.to,
        });

        this.setFeeOutput({
            value: Number(sendAmount),
            address: this.data.from,
        });
    }

    protected addInput(input: PsbtInputExtended): void {
        this.inputs.push(input);
    }

    protected addOutput(output: PsbtOutputExtended): void {
        this.outputs.push(output);
    }

    protected getSignerKey(): Signer {
        return this.tweakedSigner;
    }

    protected getTransactionFee(): bigint {
        const fakeTx = new Psbt({
            network: this.network,
        });

        fakeTx.setMaximumFeeRate(1000000);

        fakeTx.addInputs(this.getInputs());
        fakeTx.addOutputs(this.getOutputs());
        fakeTx.signAllInputs(this.getSignerKey());

        fakeTx.finalizeAllInputs();

        const tx = fakeTx.extractTransaction(false);
        const size = tx.virtualSize();
        const fee: number = this.feeRate * size;

        this.log(`Transaction fee estimated to: ${fee} - ${fakeTx.getFeeRate()}`);

        return BigInt(fee);
    }

    protected getCalldata(): void {
        if (!this.data.calldata) {
            throw new Error('Calldata is required');
        }

        const marker = Buff.encode('ord');
        const mimetype = Buff.encode('image/png');
        const imgdata = new Uint8Array([1]);

        const script = [
            this.getPubKeyXOnly(),
            'OP_CHECKSIG',
            'OP_0',
            'OP_IF',
            marker,
            '01',
            mimetype,
            'OP_0',
            imgdata,
            'OP_ENDIF',
            /*'OP_0',
            'OP_IF',
            Buff.encode('bsc'),
            '01',
            new Uint8Array([1]),
            '02',
            'OP_0',
            this.toUint8Array(this.data.calldata),
            'OP_ENDIF',*/
        ];

        /*const test = bitcoin.script.compile([
            opcodes.OP_FALSE,
            opcodes.OP_IF,
            opcodes.OP_PUSHDATA1,
            Buffer.from('bsc'),
            opcodes.OP_PUSHDATA1,
            Buffer.from([1]),
            opcodes.OP_PUSHDATA1,
            Buffer.from(this.data.calldata),
            opcodes.OP_ENDIF,
        ]);

        console.log(test.toString('hex'));*/
    }

    private generateTapAddress(): void {
        this.tapData = payments.p2tr({
            pubkey: this.getPubKeyXOnly(),
            network: this.network,
        });
    }

    private getTapPubKeyXOnly(): Buffer {
        return toXOnly(this.salt.publicKey);
    }

    private getTweakedSigner(): Signer {
        return BitcoinHelper.tweakSigner(this.salt, {
            network: this.network,
        });
    }
}
