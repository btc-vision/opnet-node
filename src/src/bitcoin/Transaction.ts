import { Logger } from '@btc-vision/motoswapcommon';
import { PsbtInput, PsbtOutput } from 'bip174/src/lib/interfaces.js';
import { BIP32Interface } from 'bip32';
import {
    networks,
    opcodes,
    Payment,
    payments,
    Psbt,
    script,
    Signer,
    Transaction,
} from 'bitcoinjs-lib';
import { Network } from 'bitcoinjs-lib/src/networks.js';
import { TransactionInput } from 'bitcoinjs-lib/src/psbt.js';
import { tapTreeToList, toXOnly } from 'bitcoinjs-lib/src/psbt/bip371.js';

import { ECPairInterface } from 'ecpair';
import { Vout } from '../blockchain-indexer/rpc/types/BitcoinRawTransaction.js';
import { BitcoinHelper, TweakSettings } from './BitcoinHelper.js';

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

interface ScriptTree {
    output: Buffer;
    version?: number;
}

export class BSCTransaction extends Logger {
    protected static readonly MINIMUM_DUST: bigint = 330n;

    public readonly logColor: string = '#785def';
    protected readonly transaction: Psbt;

    protected readonly inputs: PsbtInputExtended[] = [];
    protected readonly updateInputs: UpdateInput[] = [];

    protected readonly outputs: PsbtOutputExtended[] = [];

    protected readonly tweakedSigner: Signer;

    protected feeOutput: PsbtOutputExtended | null = null;
    protected signed: boolean = false;

    protected tapData: Payment | null = null;

    protected tapLeafScript: TapLeafScript[] = [];

    public constructor(
        protected readonly data: ITransaction,
        protected readonly salt: ECPairInterface,
        protected readonly rndPubKey: BIP32Interface,
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

        this.generateTapAddress(this.data.calldata);
        this.tweakedSigner = this.getTweakedSigner(this.getTweakerHash());

        this.transaction = new Psbt({
            network: this.network,
        });

        this.buildTransaction();
    }

    public static generateTapAddress(
        salt: ECPairInterface,
        calldata: Buffer,
        rndPubKey: BIP32Interface,
        network: Network,
    ): string {
        /*const tweakedSigner = BitcoinHelper.tweakSigner(salt, {
            network,
        });*/

        const leaf = this.getLeafScript(salt);
        const scriptTree = BSCTransaction.getScriptTree(calldata, leaf);

        /*const addr = payments.p2tr({
            internalPubkey: toXOnly(salt.publicKey),
            network,
            redeem: redeem,
            scriptTree: scriptTree,
        }).address;*/

        const addr = payments.p2tr({
            internalPubkey: toXOnly(rndPubKey.publicKey),
            scriptTree,
            network,
        }).address;

        if (!addr) {
            throw new Error('Failed to generate tap address');
        }

        return addr;
    }

    private static getLeafScript(salt: ECPairInterface): Buffer {
        return script.compile([toXOnly(salt.publicKey), opcodes.OP_CHECKSIG]);
    }

    private static getScriptTree(calldata: Buffer, leaf: Buffer): [ScriptTree, ScriptTree] {
        return [
            {
                output: leaf,
                version: 192,
            },
            {
                output: BitcoinHelper.compileData(calldata),
                version: 192,
            },
        ];
    }

    public signTransaction(): string | null {
        if (this.signed) throw new Error('Transaction is already signed');
        this.signed = true;

        const inputs: PsbtInputExtended[] = this.getInputs();
        const outputs: PsbtOutputExtended[] = this.getOutputs();

        this.transaction.setMaximumFeeRate(1000000);
        this.transaction.addInputs(inputs);

        for (let i = 0; i < this.updateInputs.length; i++) {
            this.transaction.updateInput(i, this.updateInputs[i]);
        }

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

    protected updateInput(input: UpdateInput): void {
        this.updateInputs.push(input);
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

    protected getWitness(): Buffer[] {
        if (!this.tapData || !this.tapData.witness) {
            throw new Error('Witness is required');
        }

        return this.tapData?.witness;
    }

    protected buildTransaction(): void {
        this.verifyTapAddress();

        if (!this.data.calldata) {
            throw new Error('Calldata is required');
        }

        if (!this.tapData?.scriptTree) {
            throw new Error('Script tree is required');
        }

        const input: PsbtInputExtended = {
            hash: this.data.txid,
            index: this.data.vout.n,
            witnessUtxo: {
                value: Number(this.data.value),
                script: this.getTapOutput(),
            },
            //tapInternalKey: this.getTapPubKeyXOnly(),
        };

        /*if (this.data.calldata) {
            input.tapMerkleRoot = this.getTweakerHash();
        }*/

        console.log('input', input);

        const redeem = {
            output: this.getTapOutput(),
            redeemVersion: 192,
        };

        const witness = this.getWitness();
        this.tapLeafScript = [
            {
                leafVersion: redeem.redeemVersion,
                script: redeem.output,
                controlBlock: witness![witness!.length - 1],
            },
        ];

        const updateInput = {
            tapLeafScript: this.tapLeafScript,
        };

        console.log('updateInput', updateInput);

        this.addInput(input);
        this.updateInput(updateInput);

        const sendAmount: bigint = this.data.value - BSCTransaction.MINIMUM_DUST;
        const leaf = BSCTransaction.getLeafScript(this.salt);
        const leaves = tapTreeToList(BSCTransaction.getScriptTree(this.data.calldata, leaf));
        console.log('leaves', leaves);

        this.addOutput({
            value: Number(BSCTransaction.MINIMUM_DUST),
            address: this.data.to,
            tapInternalKey: toXOnly(this.rndPubKey.publicKey), //this.getTapPubKeyXOnly(),
            tapTree: {
                leaves: leaves,
            },
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

        for (let i = 0; i < this.updateInputs.length; i++) {
            fakeTx.updateInput(i, this.updateInputs[i]);
        }

        fakeTx.addOutputs(this.getOutputs());
        fakeTx.signAllInputs(this.getSignerKey());

        const leafIndexFinalizerFn = BitcoinHelper.buildLeafIndexFinalizer(
            this.tapLeafScript[0],
            0,
        );

        fakeTx.finalizeInput(0, leafIndexFinalizerFn);
        fakeTx.finalizeAllInputs();

        const tx = fakeTx.extractTransaction(false);
        const size = tx.virtualSize();
        const fee: number = this.feeRate * size + 1;

        this.log(`Transaction fee estimated to: ${fee} - ${fakeTx.getFeeRate()}`);

        return BigInt(Math.ceil(fee));
    }

    private getTweakerHash(): Buffer | undefined {
        return this.tapData?.hash;
    }

    private generateTapAddress(calldata?: Buffer): void {
        const txData: Payment = {
            internalPubkey: this.getTapPubKeyXOnly(),
            //pubkey: this.getPubKeyXOnly(),
            network: this.network,
        };

        if (calldata) {
            const leaf = BSCTransaction.getLeafScript(this.salt);
            txData.redeem = {
                output: leaf,
                redeemVersion: 192,
            };

            txData.scriptTree = BSCTransaction.getScriptTree(calldata, leaf);
        }

        this.tapData = payments.p2tr(txData);
    }

    private getTapPubKeyXOnly(): Buffer {
        return toXOnly(this.salt.publicKey);
    }

    private getTweakedSigner(_tweakHash?: Buffer): Signer {
        const settings: TweakSettings = {
            network: this.network,
        };

        /*if (tweakHash) {
            settings.tweakHash = _tweakHash;
        }*/

        return BitcoinHelper.tweakSigner(this.salt, settings);
    }
}
