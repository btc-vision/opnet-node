import { TransactionTypes } from './transaction/TransactionTypes.js';
import { PSBTProcessedResponse, PSBTProcessor } from './processor/PSBTProcessor.js';
import { ConfigurableDBManager } from '@btc-vision/bsi-common';
import { Network } from '@btc-vision/bitcoin';
import { OPNetIdentity } from '../identity/OPNetIdentity.js';
import { BitcoinRPC } from '@btc-vision/bitcoin-rpc';
import { KnownPSBTObject } from './transaction/TransactionVerifierManager.js';

export class PSBTProcessorManager {
    private readonly verificator: PSBTProcessor<TransactionTypes>[] = [];

    public constructor(
        private readonly authority: OPNetIdentity,
        private readonly db: ConfigurableDBManager,
        private readonly network: Network,
    ) {
        // DISABLED WBTC 2024-11-07.
        //this.verificator.push(new UnwrapProcessor(authority, db, network));
    }

    public async processPSBT(data: KnownPSBTObject): Promise<PSBTProcessedResponse> {
        const processor = this.verificator.find((v) => v.type === data.type);
        if (processor) {
            return processor.process(data.psbt, data.data);
        }

        throw new Error('Unknown PSBT type');
    }

    public async createRepositories(rpc: BitcoinRPC): Promise<void> {
        const promises = this.verificator.map((v) => v.createRepositories(rpc));

        await Promise.safeAll(promises);
    }
}
