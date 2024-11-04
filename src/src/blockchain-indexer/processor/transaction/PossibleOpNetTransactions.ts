import { TransactionData } from '@btc-vision/bsi-bitcoin-rpc';
import bitcoin from '@btc-vision/bitcoin';
import { OPNetTransactionTypes } from './enums/OPNetTransactionTypes.js';
import { Transaction } from './Transaction.js';
import { DeploymentTransaction } from './transactions/DeploymentTransaction.js';
import { GenericTransaction } from './transactions/GenericTransaction.js';
import { InteractionTransaction } from './transactions/InteractionTransaction.js';
import { WrapTransaction } from './transactions/WrapTransaction.js';
import { UnwrapTransaction } from './transactions/UnwrapTransaction.js';

export type OPNetTransactionByType<T extends OPNetTransactionTypes> = (
    data: TransactionData,
    vIndexIn: number,
    blockHash: string,
    blockHeight: bigint,
    network: bitcoin.networks.Network,
) => Transaction<T>;

export interface TransactionInformation {
    type: OPNetTransactionTypes;
    vInIndex: number;
}

export interface TransactionParser<T extends OPNetTransactionTypes> {
    parse: OPNetTransactionByType<T>;

    isTransaction(data: TransactionData): TransactionInformation | undefined;
}

export const PossibleOpNetTransactions: {
    [key in OPNetTransactionTypes]: TransactionParser<key>;
} = {
    [OPNetTransactionTypes.Generic]: {
        parse: (...args) => new GenericTransaction(...args),
        isTransaction(data: TransactionData): TransactionInformation | undefined {
            return GenericTransaction.is(data);
        },
    },
    [OPNetTransactionTypes.Interaction]: {
        parse: (...args) =>
            new InteractionTransaction(...args) as Transaction<OPNetTransactionTypes.Interaction>,
        isTransaction(data: TransactionData): TransactionInformation | undefined {
            return InteractionTransaction.is(data);
        },
    },
    [OPNetTransactionTypes.WrapInteraction]: {
        parse: (...args) =>
            new WrapTransaction(...args) as Transaction<OPNetTransactionTypes.WrapInteraction>,
        isTransaction(data: TransactionData): TransactionInformation | undefined {
            return WrapTransaction.is(data);
        },
    },
    [OPNetTransactionTypes.Deployment]: {
        parse: (...args) => new DeploymentTransaction(...args),
        isTransaction(data: TransactionData): TransactionInformation | undefined {
            return DeploymentTransaction.is(data);
        },
    },
    [OPNetTransactionTypes.UnwrapInteraction]: {
        parse: (...args) =>
            new UnwrapTransaction(...args) as Transaction<OPNetTransactionTypes.UnwrapInteraction>,
        isTransaction(data: TransactionData): TransactionInformation | undefined {
            return UnwrapTransaction.is(data);
        },
    },
};
