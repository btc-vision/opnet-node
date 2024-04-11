import { networks, Signer } from 'bitcoinjs-lib';
import { Network } from 'bitcoinjs-lib/src/networks.js';
import { ECPairInterface } from 'ecpair';
import { BSCTransaction, ITransaction } from './Transaction.js';

export class BSCSegwitTransaction extends BSCTransaction {
    constructor(
        data: ITransaction,
        salt: ECPairInterface,
        network: Network = networks.bitcoin,
        feeRate: number = 1,
    ) {
        super(data, salt, network, feeRate);
    }

    protected override buildTransaction(): void {
        this.verifyTapAddress();

        this.addInput({
            hash: this.data.txid,
            index: this.data.vout.n,
            witnessUtxo: {
                value: Number(this.data.value),
                script: Buffer.from(this.data.vout.scriptPubKey.hex, 'hex'),
            },
        });

        this.setFeeOutput({
            value: Number(this.data.value),
            address: this.data.to,
        });
    }

    protected override getSignerKey(): Signer {
        return this.salt;
    }
}
