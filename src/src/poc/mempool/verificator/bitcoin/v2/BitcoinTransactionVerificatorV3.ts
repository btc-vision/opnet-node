import { TransactionTypes } from '../../../transaction/TransactionTypes.js';
import { Network, networks } from '@btc-vision/bitcoin';
import { ConfigurableDBManager } from '@btc-vision/bsi-common';
import { BitcoinRPC } from '@btc-vision/bitcoin-rpc';
import { BitcoinTransactionVerificatorV2 } from './BitcoinTransactionVerificatorV2.js';

type Verificator = [TransactionTypes.BITCOIN_TRANSACTION_V3];

export class BitcoinTransactionVerificatorV3 extends BitcoinTransactionVerificatorV2 {
    public readonly type: Verificator = [TransactionTypes.BITCOIN_TRANSACTION_V3];

    public constructor(
        db: ConfigurableDBManager,
        rpc: BitcoinRPC,
        network: Network = networks.bitcoin,
    ) {
        super(db, rpc, network);
    }

    protected getTxVersion(version: number): TransactionTypes {
        if (version === 3) {
            return TransactionTypes.BITCOIN_TRANSACTION_V3;
        }

        throw new Error(`Unsupported transaction version: ${version}. Expected 3.`);
    }
}
