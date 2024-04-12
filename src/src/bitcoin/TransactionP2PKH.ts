import { networks, Signer } from 'bitcoinjs-lib';
import { Network } from 'bitcoinjs-lib/src/networks.js';
import { ECPairInterface } from 'ecpair';
import { BSCTransaction, ITransaction, PsbtInputExtended } from './Transaction.js';

export class BSCSegwitTransaction extends BSCTransaction {
    constructor(
        data: ITransaction,
        salt: ECPairInterface,
        network: Network = networks.bitcoin,
        feeRate: number = 1,
    ) {
        super(data, salt, network, feeRate);

        this.internalInit();
    }

    public async requestUTXO(): Promise<void> {}

    protected override buildTransaction(to: string): void {
        const input: PsbtInputExtended = {
            hash: this.data.txid,
            index: this.data.vout.n,
            witnessUtxo: {
                value: Number(this.data.value),
                script: Buffer.from(this.data.vout.scriptPubKey.hex, 'hex'),
            },
        };

        this.addInput(input);

        console.log('Segwit input ->', input);

        this.setFeeOutput({
            value: Number(this.data.value),
            address: to,
        });
    }

    protected override getSignerKey(): Signer {
        return this.salt;
    }
}
