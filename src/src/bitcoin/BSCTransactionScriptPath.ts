import { networks, opcodes, Payment, payments, script, Signer } from 'bitcoinjs-lib';
import { Network } from 'bitcoinjs-lib/src/networks.js';
import { toXOnly } from 'bitcoinjs-lib/src/psbt/bip371.js';
import { Taptree } from 'bitcoinjs-lib/src/types.js';
import { ECPairInterface } from 'ecpair';
import { BitcoinHelper, TweakSettings } from './BitcoinHelper.js';
import { BSCTransaction, ITransaction, PsbtInputExtended } from './Transaction.js';

export class BSCTransactionScriptPath extends BSCTransaction {
    //private targetScriptRedeem: RedeemScript | null = null;
    private leftOverFundsScriptRedeem: Payment | null = null;

    private readonly compiledTargetScript: Buffer;
    private readonly scriptTree: Taptree;

    private readonly tweakedSigner: Signer;

    public constructor(
        data: ITransaction,
        salt: ECPairInterface,
        network: Network = networks.bitcoin,
        feeRate: number = 1,
    ) {
        super(data, salt, network, feeRate);

        if (!this.data.calldata) {
            throw new Error('Calldata is required');
        }

        this.compiledTargetScript = BitcoinHelper.compileData(this.data.calldata);
        this.scriptTree = this.getScriptTree();

        this.internalInit();

        //console.log(this.getScriptAddress(), this.getTapAddress());

        this.tweakedSigner = this.getTweakedSigner();
    }

    public static getFundingAddress(
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
    }

    public async requestUTXO(): Promise<void> {}

    protected override buildTransaction(contractAddress: string = this.getScriptAddress()): void {
        if (!this.leftOverFundsScriptRedeem) {
            throw new Error('Left over funds script redeem is required');
        }

        if (!this.leftOverFundsScriptRedeem.redeemVersion) {
            throw new Error('Left over funds script redeem version is required');
        }

        if (!this.leftOverFundsScriptRedeem.output) {
            throw new Error('Left over funds script redeem output is required');
        }

        console.log(
            'expected',
            Buffer.from(this.data.vout.scriptPubKey.hex, 'hex'),
            this.getTapOutput(),
        );

        const input: PsbtInputExtended = {
            hash: this.data.txid,
            index: this.data.vout.n,
            witnessUtxo: {
                value: Number(this.data.value),
                script: this.getTapOutput(),
            },
            tapLeafScript: [
                {
                    leafVersion: this.leftOverFundsScriptRedeem.redeemVersion,
                    script: this.leftOverFundsScriptRedeem.output,
                    controlBlock: this.getWitness(),
                },
            ],
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
        if (!this.leftOverFundsScriptRedeem) {
            throw new Error('Left over funds script redeem is required');
        }

        if (!this.scriptTree) {
            throw new Error('Script tree is required');
        }

        return {
            internalPubkey: this.internalPubKeyToXOnly(),
            network: this.network,
            scriptTree: this.scriptTree,
            redeem: this.leftOverFundsScriptRedeem,
        };
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
        /*this.targetScriptRedeem = {
            output: this.compiledTargetScript,
            redeemVersion: 192,
        };*/ // I think this is not needed

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
