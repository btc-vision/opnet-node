import { BlockDataWithTransactionData } from '@btc-vision/bsi-bitcoin-rpc';
import { OPNetTransactionTypes } from './enums/OPNetTransactionTypes.js';

export abstract class Transaction<T extends OPNetTransactionTypes> {
    public abstract readonly transactionType: T;

    protected constructor(protected readonly rawTransactionData: BlockDataWithTransactionData) {}
}
