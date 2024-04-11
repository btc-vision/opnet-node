import { BIP32Interface } from 'bip32';
import { networks, Signer } from 'bitcoinjs-lib';
import { Network } from 'bitcoinjs-lib/src/networks.js';
import { ECPairInterface } from 'ecpair';
import { BSCTransaction, ITransaction, PsbtInputExtended } from './Transaction.js';

export class BSCSegwitTransaction extends BSCTransaction {
    constructor(
        data: ITransaction,
        salt: ECPairInterface,
        rndPubKey: BIP32Interface,
        network: Network = networks.bitcoin,
        feeRate: number = 1,
    ) {
        super(data, salt, rndPubKey, network, feeRate);
    }

    protected override buildTransaction(): void {
        this.verifyTapAddress();

        const input: PsbtInputExtended = {
            hash: this.data.txid,
            index: this.data.vout.n,
            witnessUtxo: {
                value: Number(this.data.value),
                script: Buffer.from(this.data.vout.scriptPubKey.hex, 'hex'),
            },
        };

        this.addInput(input);

        console.log('input 2', input);

        this.setFeeOutput({
            value: Number(this.data.value),
            address: this.data.to,
        });
    }

    protected override getSignerKey(): Signer {
        return this.salt;
    }
}
