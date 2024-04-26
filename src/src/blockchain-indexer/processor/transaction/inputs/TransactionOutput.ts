import { ScriptPubKey } from '@btc-vision/bsi-bitcoin-rpc';
import { VOut } from '@btc-vision/bsi-bitcoin-rpc/src/rpc/types/BlockData.js';
import { script } from 'bitcoinjs-lib';
import { Decimal128 } from 'mongodb';

export interface ITransactionOutput {
    readonly value: Decimal128;
    readonly index: number;
    readonly scriptPubKey: {
        hex: string;
        addresses?: string[];
        address?: string;
    };
}

export class TransactionOutput {
    public readonly value: bigint;
    public readonly index: number;

    public readonly scriptPubKey: ScriptPubKey;
    public readonly script: Array<number | Buffer> | null;

    constructor(data: VOut) {
        this.value = this.convertValue(data.value);
        this.index = data.n;

        this.scriptPubKey = data.scriptPubKey;
        this.script = script.decompile(Buffer.from(this.scriptPubKey.hex, 'hex'));
    }

    public toDocument(): ITransactionOutput {
        return {
            value: new Decimal128(this.value.toString()),
            index: this.index,
            scriptPubKey: {
                hex: this.scriptPubKey.hex,
                addresses: this.scriptPubKey.addresses,
                address: this.scriptPubKey.address,
            },
        };
    }

    private convertValue(value: number): bigint {
        return BigInt(value * 1e8);
    }
}
