import { PSBTTypes } from '../psbt/PSBTTypes.js';
import { ConfigurableDBManager, Logger } from '@btc-vision/bsi-common';
import { Network, Psbt } from 'bitcoinjs-lib';
import { PSBTDecodedData } from '../psbt/PSBTTransactionVerifier.js';
import { OPNetIdentity } from '../../identity/OPNetIdentity.js';
import { BitcoinRPC } from '@btc-vision/bsi-bitcoin-rpc';

export interface PSBTProcessedResponse {
    readonly psbt: Psbt;
    readonly modified: boolean;
    readonly finalized: boolean;
    readonly hash: string;
}

export abstract class PSBTProcessor<T extends PSBTTypes> extends Logger {
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
