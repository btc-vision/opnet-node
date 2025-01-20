import { TransactionData } from '@btc-vision/bitcoin-rpc';
import { OPNetTransactionTypes } from './enums/OPNetTransactionTypes.js';
import { Transaction } from './Transaction.js';
import { DeploymentTransaction } from './transactions/DeploymentTransaction.js';
import { GenericTransaction } from './transactions/GenericTransaction.js';
import { InteractionTransaction } from './transactions/InteractionTransaction.js';
import { networks } from '@btc-vision/bitcoin';

export type OPNetTransactionByType<T extends OPNetTransactionTypes> = (
    data: TransactionData,
    vIndexIn: number,
    blockHash: string,
    blockHeight: bigint,
    network: networks.Network,
) => Transaction<T>;

export interface TransactionInformation {
    type: OPNetTransactionTypes;
    vInIndex: number;
}

export interface TransactionParser<T extends OPNetTransactionTypes> {
    parse: OPNetTransactionByType<T>;

    isTransaction(
        data: TransactionData,
        utxoResolver: (
            txid: string,
            vout: number,
        ) => Promise<{ scriptPubKeyHex: string; type: string } | undefined>,
    ): Promise<TransactionInformation | undefined>;
}

export const PossibleOpNetTransactions: {
    [key in OPNetTransactionTypes]: TransactionParser<key>;
} = {
    [OPNetTransactionTypes.Generic]: {
        parse: (...args) => new GenericTransaction(...args),
        isTransaction(
            data: TransactionData,
            utxoResolver: (
                txid: string,
                vout: number,
            ) => Promise<{ scriptPubKeyHex: string; type: string } | undefined>,
        ): Promise<TransactionInformation | undefined> {
            return GenericTransaction.is(data, utxoResolver);
        },
    },
    [OPNetTransactionTypes.Interaction]: {
        parse: (...args) =>
            new InteractionTransaction(...args) as Transaction<OPNetTransactionTypes.Interaction>,
        isTransaction(
            data: TransactionData,
            utxoResolver: (
                txid: string,
                vout: number,
            ) => Promise<{ scriptPubKeyHex: string; type: string } | undefined>,
        ): Promise<TransactionInformation | undefined> {
            return InteractionTransaction.is(data, utxoResolver);
        },
    },
    [OPNetTransactionTypes.Deployment]: {
        parse: (...args) => new DeploymentTransaction(...args),
        isTransaction(
            data: TransactionData,
            utxoResolver: (
                txid: string,
                vout: number,
            ) => Promise<{ scriptPubKeyHex: string; type: string } | undefined>,
        ): Promise<TransactionInformation | undefined> {
            return DeploymentTransaction.is(data, utxoResolver);
        },
    },
};
