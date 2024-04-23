import { TransactionData, VIn, VOut } from '@btc-vision/bsi-bitcoin-rpc';
import { opcodes } from 'bitcoinjs-lib';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { TransactionInformation } from '../PossibleOpNetTransactions.js';
import { Transaction } from '../Transaction.js';

/* TODO: Potentially allow multiple contract interaction per transaction since BTC supports that? Maybe, in the future, for now let's stick with one. */
export class InteractionTransaction extends Transaction<OPNetTransactionTypes.Interaction> {
    public static LEGACY_INTERACTION: Buffer = Buffer.from([
        opcodes.OP_CHECKSIGVERIFY,

        opcodes.OP_HASH160,
        opcodes.OP_EQUALVERIFY,

        opcodes.OP_HASH160,
        opcodes.OP_EQUALVERIFY,

        opcodes.OP_DEPTH,
        opcodes.OP_1,
        opcodes.OP_NUMEQUAL,
        opcodes.OP_IF,

        opcodes.OP_1NEGATE,

        opcodes.OP_ELSE,
        opcodes.OP_1,
        opcodes.OP_ENDIF,
    ]);

    public readonly transactionType: OPNetTransactionTypes.Interaction =
        InteractionTransaction.getType();

    constructor(rawTransactionData: TransactionData, vIndexIn: number, blockHash: string) {
        super(rawTransactionData, vIndexIn, blockHash);
    }

    public static is(data: TransactionData): TransactionInformation | undefined {
        const vIndex = this._is(data, this.LEGACY_INTERACTION);

        if (vIndex === -1) {
            return;
        }

        return {
            type: this.getType(),
            vInIndex: vIndex,
        };
    }

    private static getType(): OPNetTransactionTypes.Interaction {
        return OPNetTransactionTypes.Interaction;
    }

    protected parseTransaction(vIn: VIn[], vOuts: VOut[]) {
        super.parseTransaction(vIn, vOuts);
    }
}
