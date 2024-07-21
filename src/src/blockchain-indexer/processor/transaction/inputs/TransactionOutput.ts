import { ScriptPubKey, VOut } from '@btc-vision/bsi-bitcoin-rpc';
import BigNumber from 'bignumber.js';
import { script } from 'bitcoinjs-lib';
import { Decimal128 } from 'mongodb';

export interface ITransactionOutputBase {
    readonly value: Decimal128 | string;
    readonly index: number;
    readonly scriptPubKey: {
        hex: string;
        addresses?: string[];
        address?: string;
    };
}

export interface ITransactionOutput extends ITransactionOutputBase {
    readonly value: Decimal128;
}

export interface APIDocumentOutput extends ITransactionOutputBase {
    readonly value: string;
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
        // Safe conversion from decimal float to bigint 8 decimal places
        let bigNumber: BigNumber = new BigNumber(value.toString());
        bigNumber = bigNumber.multipliedBy('100000000').decimalPlaces(0);

        return BigInt(bigNumber.toString());
    }
}
