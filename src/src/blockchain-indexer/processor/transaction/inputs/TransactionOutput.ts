import { ScriptPubKey } from '@btc-vision/bsi-bitcoin-rpc';
import { VOut } from '@btc-vision/bsi-bitcoin-rpc/src/rpc/types/BlockData.js';
import { script } from 'bitcoinjs-lib';

export class TransactionOutput {
    public readonly value: number;
    public readonly index: number;

    public readonly scriptPubKey: ScriptPubKey;
    public readonly script: Array<number | Buffer> | null;

    constructor(data: VOut) {
        this.value = data.value;
        this.index = data.n;

        this.scriptPubKey = data.scriptPubKey;
        this.script = script.decompile(Buffer.from(this.scriptPubKey.hex, 'hex'));
    }
}
