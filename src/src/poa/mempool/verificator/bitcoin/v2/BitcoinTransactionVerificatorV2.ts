import { TransactionVerifier } from '../../TransactionVerifier.js';
import { TransactionTypes } from '../../../transaction/TransactionTypes.js';
import { Network, networks, Psbt } from '@btc-vision/bitcoin';
import { ConfigurableDBManager } from '@btc-vision/bsi-common';
import { KnownTransaction } from '../../../transaction/TransactionVerifierManager.js';

export class BitcoinTransactionVerificatorV2 extends TransactionVerifier<TransactionTypes.BITCOIN_TRANSACTION_V2> {
    public readonly type: TransactionTypes.BITCOIN_TRANSACTION_V2 =
        TransactionTypes.BITCOIN_TRANSACTION_V2;

    public constructor(db: ConfigurableDBManager, network: Network = networks.bitcoin) {
        super(db, network);
    }

    public createRepositories(): void {}

    public verify(data: Psbt): Promise<KnownTransaction | false> {
        console.log(`Verifying Bitcoin Transaction V2...`, data);

        return Promise.resolve(false);
    }
}
