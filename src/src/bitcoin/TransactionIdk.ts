import { networks, Payment, Signer } from 'bitcoinjs-lib';
import { Network } from 'bitcoinjs-lib/src/networks.js';
import { toXOnly } from 'bitcoinjs-lib/src/psbt/bip371.js';
import { ECPairInterface } from 'ecpair';
import { BitcoinHelper, TweakSettings } from './BitcoinHelper.js';
import { BSCTransaction, ITransaction, PsbtInputExtended } from './Transaction.js';

export class BSCTransactionP2PKTR extends BSCTransaction {
    private readonly tweakedSigner: Signer;

    constructor(
        data: ITransaction,
        salt: ECPairInterface,
        network: Network = networks.bitcoin,
        feeRate: number = 1,
    ) {
        super(data, salt, network, feeRate);

        this.internalInit();

        this.tweakedSigner = this.getTweakedSigner();
    }

    public async requestUTXO(): Promise<void> {}

    protected override buildTransaction(to: string): void {
        if (!this.scriptData || !this.scriptData.output) {
            throw new Error('Script data is required');
        }

        const input: PsbtInputExtended = {
            hash: this.data.txid,
            index: this.data.vout.n,
            witnessUtxo: {
                value: Number(this.data.value),
                script: this.scriptData.output,
            },
            tapInternalKey: this.internalPubKeyToXOnly(),
        };

        this.addInput(input);

        console.log('idk input ->', input);

        this.setFeeOutput({
            value: Number(this.data.value),
            address: to,
        });
    }

    protected generateScriptAddress(): Payment {
        return {
            pubkey: this.tweakedSignerPubKeyXOnly(),
            network: this.network,
        };
    }

    protected override getSignerKey(): Signer {
        return this.salt;
    }

    private tweakedSignerPubKeyXOnly(): Buffer {
        if (!this.tweakedSigner.publicKey) {
            throw new Error('Tweaked signer public key is required');
        }

        return toXOnly(this.tweakedSigner.publicKey);
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

    private getTweakerHash(): Buffer | undefined {
        return this.tapData?.hash;
    }
}
