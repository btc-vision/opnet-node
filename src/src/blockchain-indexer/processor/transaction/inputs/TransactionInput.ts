import { ScriptSig, VIn } from '@btc-vision/bsi-bitcoin-rpc';

export class TransactionInput {
    public readonly originalTransactionId: string | undefined;
    public readonly outputTransactionIndex: number | undefined; // consumer output index

    public readonly scriptSignature: ScriptSig | undefined;
    public readonly sequenceId: number;

    public readonly transactionInWitness: string[] = [];

    constructor(data: VIn) {
        this.originalTransactionId = data.txid;
        this.outputTransactionIndex = data.vout;

        this.scriptSignature = data.scriptSig;

        this.sequenceId = data.sequence;
        this.transactionInWitness = data.txinwitness;
    }
}
