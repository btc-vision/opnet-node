import { PsbtInput } from 'bip174/src/lib/interfaces.js';
import { networks, opcodes, Payment, Psbt, script, Signer } from 'bitcoinjs-lib';
import { varuint } from 'bitcoinjs-lib/src/bufferutils.js';
import { Network } from 'bitcoinjs-lib/src/networks.js';
import { toXOnly } from 'bitcoinjs-lib/src/psbt/bip371.js';
import { Taptree } from 'bitcoinjs-lib/src/types.js';
import { ECPairInterface } from 'ecpair';
import { BitcoinHelper, TweakSettings } from './BitcoinHelper.js';
import {
    BSCTransaction,
    ITransactionDataContractInteraction,
    PsbtInputExtended,
    TapLeafScript,
} from './Transaction.js';

export class BSCTransactionScriptPath extends BSCTransaction {
    private targetScriptRedeem: Payment | null = null;
    private leftOverFundsScriptRedeem: Payment | null = null;

    private readonly compiledTargetScript: Buffer;
    private readonly scriptTree: Taptree;

    private readonly tweakedSigner: Signer;

    private tapLeafScript: TapLeafScript | null = null;

    public constructor(
        protected readonly data: ITransactionDataContractInteraction,
        salt: ECPairInterface,
        randomKeyPair: ECPairInterface,
        network: Network = networks.bitcoin,
        feeRate: number = 1,
    ) {
        super(data, salt, network, feeRate);

        if (!this.data.calldata) {
            throw new Error('Calldata is required');
        }

        if (!this.data.contractSecret) {
            throw new Error('Contract secret is required');
        }

        this.compiledTargetScript = BitcoinHelper.compileData(
            this.data.calldata,
            toXOnly(randomKeyPair.publicKey),
            this.internalPubKeyToXOnly(),
            this.data.contractSecret,
        );

        this.scriptTree = this.getScriptTree();

        this.internalInit();

        this.tweakedSigner = this.getTweakedSigner();
    }

    /*public static getFundingAddress(
        MY_KEYPAIR: ECPairInterface,
        scriptTree: Taptree,
        network = networks.bitcoin,
    ): string {
        const LEFT_OVER_P2TR = payments.p2tr({
            internalPubkey: toXOnly(MY_KEYPAIR.publicKey),
            scriptTree,
            network,
        });

        if (!LEFT_OVER_P2TR.address) throw new Error('Address not found');

        return LEFT_OVER_P2TR.address;
    }*/

    public async requestUTXO(): Promise<void> {}

    protected override buildTransaction(contractAddress: string = this.getScriptAddress()): void {
        const selectedRedeem = !!this.data.customSigner
            ? this.targetScriptRedeem
            : this.leftOverFundsScriptRedeem;

        if (!selectedRedeem) {
            throw new Error('Left over funds script redeem is required');
        }

        if (!selectedRedeem.redeemVersion) {
            throw new Error('Left over funds script redeem version is required');
        }

        if (!selectedRedeem.output) {
            throw new Error('Left over funds script redeem output is required');
        }

        this.tapLeafScript = {
            leafVersion: selectedRedeem.redeemVersion,
            script: selectedRedeem.output,
            controlBlock: this.getWitness(),
        };

        const input: PsbtInputExtended = {
            hash: this.data.txid,
            index: this.data.vout.n,
            witnessUtxo: {
                value: Number(this.data.value),
                script: this.getTapOutput(),
            },
            tapLeafScript: [this.tapLeafScript],
        };

        this.addInput(input);

        const amountSentToContract = BSCTransaction.MINIMUM_DUST;
        this.addOutput({
            value: Number(amountSentToContract),
            address: contractAddress,
        });

        const sendAmount: bigint = this.data.value - amountSentToContract;
        this.setFeeOutput({
            value: Number(sendAmount),
            address: this.data.from,
        });
    }

    protected signInputs(transaction: Psbt): void {
        if (!this.data.customSigner) {
            super.signInputs(transaction);

            return;
        }

        this.log(`Signing transaction with custom signer`);

        transaction.signInput(0, this.data.customSigner);
        transaction.finalizeInput(0, this.customFinalizer);
    }

    protected getSignerKey(): Signer {
        if (!this.tweakedSigner) {
            throw new Error('Tweaked signer is required');
        }

        return this.salt;
    }

    protected override generateScriptAddress(): Payment {
        return {
            internalPubkey: this.internalPubKeyToXOnly(),
            network: this.network,
            scriptTree: this.scriptTree,
        };
    }

    protected override generateTapData(): Payment {
        const selectedRedeem = !!this.data.customSigner
            ? this.targetScriptRedeem
            : this.leftOverFundsScriptRedeem;

        if (!selectedRedeem) {
            throw new Error('Left over funds script redeem is required');
        }

        if (!this.scriptTree) {
            throw new Error('Script tree is required');
        }

        return {
            internalPubkey: this.internalPubKeyToXOnly(),
            network: this.network,
            scriptTree: this.scriptTree,
            redeem: selectedRedeem,
        };
    }

    private customFinalizer = (_inputIndex: number, input: PsbtInput) => {
        if (!this.tapLeafScript) {
            throw new Error('Tap leaf script is required');
        }

        if (!input.tapScriptSig) {
            throw new Error('Tap script signature is required');
        }

        if (!this.data.contractSecret) {
            throw new Error('Contract secret is required');
        }

        const scriptSolution = [
            this.data.contractSecret,
            this.internalPubKeyToXOnly(),
            input.tapScriptSig[0].signature,
        ];

        const witness = scriptSolution
            .concat(this.tapLeafScript.script)
            .concat(this.tapLeafScript.controlBlock);

        return {
            finalScriptWitness: this.witnessStackToScriptWitness(witness),
        };
    };

    private witnessStackToScriptWitness(witness: Buffer[]) {
        let buffer = Buffer.allocUnsafe(0);

        function writeSlice(slice: Buffer) {
            buffer = Buffer.concat([buffer, Buffer.from(slice)]);
        }

        function writeVarInt(i: number) {
            const currentLen = buffer.length;
            const varintLen = varuint.encodingLength(i);

            buffer = Buffer.concat([buffer, Buffer.allocUnsafe(varintLen)]);
            varuint.encode(i, buffer, currentLen);
        }

        function writeVarSlice(slice: Buffer) {
            writeVarInt(slice.length);
            writeSlice(slice);
        }

        function writeVector(vector: Buffer[]) {
            writeVarInt(vector.length);
            vector.forEach(writeVarSlice);
        }

        writeVector(witness);

        return buffer;
    }

    private getTweakerHash(): Buffer | undefined {
        return this.tapData?.hash;
    }

    private getTweakedSigner(useTweakedHash: boolean = false): Signer {
        const settings: TweakSettings = {
            network: this.network,
        };

        if (useTweakedHash) {
            settings.tweakHash = this.getTweakerHash();
        }

        return BitcoinHelper.tweakSigner(this.salt, settings);
    }

    private generateRedeemScripts(): void {
        this.targetScriptRedeem = {
            output: this.compiledTargetScript,
            redeemVersion: 192,
        };

        this.leftOverFundsScriptRedeem = {
            output: this.getLeafScript(),
            redeemVersion: 192,
        };
    }

    private getLeafScript(): Buffer {
        return script.compile([this.internalPubKeyToXOnly(), opcodes.OP_CHECKSIG]); //Buffer.from(this.data.vout.scriptPubKey.hex, 'hex');
    }

    private getScriptTree(): Taptree {
        if (!this.data.calldata) {
            throw new Error('Calldata is required');
        }

        this.generateRedeemScripts();

        return [
            {
                output: this.compiledTargetScript,
                version: 192,
            },
            {
                output: this.getLeafScript(),
                version: 192,
            },
        ];
    }
}
