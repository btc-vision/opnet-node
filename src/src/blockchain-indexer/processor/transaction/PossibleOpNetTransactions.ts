import { TransactionData } from '@btc-vision/bsi-bitcoin-rpc';
import { OPNetTransactionTypes } from './enums/OPNetTransactionTypes.js';
import { Transaction } from './Transaction.js';
import { DeploymentTransaction } from './transactions/DeploymentTransaction.js';
import { GenericTransaction } from './transactions/GenericTransaction.js';
import { InteractionTransaction } from './transactions/InteractionTransaction.js';

export type OPNetTransactionByType<T extends OPNetTransactionTypes> = (
    data: TransactionData,
    blockHash: string,
) => Transaction<T>;

export interface TransactionParser<T extends OPNetTransactionTypes> {
    parse: OPNetTransactionByType<T>;

    isTransaction(data: TransactionData): OPNetTransactionTypes | undefined;
}

export const PossibleOpNetTransactions: {
    [key in OPNetTransactionTypes]: TransactionParser<key>;
} = {
    [OPNetTransactionTypes.Generic]: {
        parse: (...args) => new GenericTransaction(...args),
        isTransaction(data: TransactionData): OPNetTransactionTypes | undefined {
            return GenericTransaction.is(data);
        },
    },
    [OPNetTransactionTypes.Interaction]: {
        parse: (...args) => new InteractionTransaction(...args),
        isTransaction(data: TransactionData): OPNetTransactionTypes | undefined {
            return InteractionTransaction.is(data);
        },
    },
    [OPNetTransactionTypes.Deployment]: {
        parse: (...args) => new DeploymentTransaction(...args),
        isTransaction(data: TransactionData): OPNetTransactionTypes | undefined {
            return DeploymentTransaction.is(data);
        },
    },
};
