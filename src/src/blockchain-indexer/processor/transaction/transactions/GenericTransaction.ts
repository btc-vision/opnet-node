import { TransactionData } from '@btc-vision/bitcoin-rpc';
import { networks } from '@btc-vision/bitcoin';
import { OPNetTransactionTypes } from '../enums/OPNetTransactionTypes.js';
import { TransactionInformation } from '../PossibleOPNetTransactions.js';
import { Transaction } from '../Transaction.js';
import { AddressCache } from '../../AddressCache.js';

export class GenericTransaction extends Transaction<OPNetTransactionTypes.Generic> {
    public readonly transactionType: OPNetTransactionTypes.Generic = GenericTransaction.getType();

    public constructor(
        rawTransactionData: TransactionData,
        vIndexIn: number,
        blockHash: string,
        blockHeight: bigint,
        network: networks.Network,
        addressCache: AddressCache | undefined,
    ) {
        super(rawTransactionData, vIndexIn, blockHash, blockHeight, network, addressCache);
    }

    public static is(_data: TransactionData): TransactionInformation | undefined {
        return {
            type: this.getType(),
            vInIndex: 0,
        };
    }

    private static getType(): OPNetTransactionTypes.Generic {
        return OPNetTransactionTypes.Generic;
    }
}
