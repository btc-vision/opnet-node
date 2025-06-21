import { TransactionTypes } from '../transaction/TransactionTypes.js';
import { ConfigurableDBManager, Logger } from '@btc-vision/bsi-common';
import { Network, Psbt } from '@btc-vision/bitcoin';
import { PSBTDecodedData } from '../transaction/TransactionVerifierManager.js';
import { OPNetIdentity } from '../../identity/OPNetIdentity.js';
import { BitcoinRPC } from '@btc-vision/bitcoin-rpc';

export interface PSBTProcessedResponse {
    readonly psbt: Psbt;
    readonly modified: boolean;
    readonly finalized: boolean;
    readonly hash: string;
}

export abstract class PSBTProcessor<T extends TransactionTypes> extends Logger {
    public abstract readonly type: T;

    protected constructor(
        protected readonly authority: OPNetIdentity,
        protected readonly db: ConfigurableDBManager,
        protected readonly network: Network,
    ) {
        super();
    }

    public abstract createRepositories(rpc: BitcoinRPC): void;

    public abstract process(
        psbt: Psbt,
        data: PSBTDecodedData,
    ): Promise<PSBTProcessedResponse> | PSBTProcessedResponse;
}
