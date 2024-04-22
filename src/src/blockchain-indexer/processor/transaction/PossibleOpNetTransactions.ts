import { BlockDataWithTransactionData } from '@btc-vision/bsi-bitcoin-rpc';
import { OPNetTransactionTypes } from './enums/OPNetTransactionTypes.js';
import { Transaction } from './Transaction.js';
import { DeploymentTransaction } from './transactions/DeploymentTransaction.js';
import { InteractionTransaction } from './transactions/InteractionTransaction.js';

export type OPNetTransactionByType<T extends OPNetTransactionTypes> = (
    data: BlockDataWithTransactionData,
) => Transaction<T>;

export interface TransactionParser<T extends OPNetTransactionTypes> {
    parse: OPNetTransactionByType<T>;

    isTransaction(data: BlockDataWithTransactionData): OPNetTransactionTypes;
}

export const PossibleOpNetTransactions: {
    [key in OPNetTransactionTypes]: TransactionParser<key>;
} = {
    [OPNetTransactionTypes.Interaction]: {
        parse: (...args) => new InteractionTransaction(...args),
        isTransaction(data: BlockDataWithTransactionData): OPNetTransactionTypes {
            return InteractionTransaction.is(data);
        },
    },
    [OPNetTransactionTypes.Deployment]: {
        parse: (...args) => new DeploymentTransaction(...args),
        isTransaction(data: BlockDataWithTransactionData): OPNetTransactionTypes {
            return DeploymentTransaction.is(data);
        },
    },
};
