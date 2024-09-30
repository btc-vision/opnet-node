import { KnownPSBTObject } from './psbt/PSBTTransactionVerifier.js';
import { PSBTTypes } from './psbt/PSBTTypes.js';
import { PSBTProcessedResponse, PSBTProcessor } from './processor/PSBTProcessor.js';
import { ConfigurableDBManager } from '@btc-vision/bsi-common';
import { UnwrapProcessor } from './processor/UnwrapProcessor.js';
import { Network } from 'bitcoinjs-lib';
import { OPNetIdentity } from '../identity/OPNetIdentity.js';
import { BitcoinRPC } from '@btc-vision/bsi-bitcoin-rpc';

export class PSBTProcessorManager {
    private readonly verificator: PSBTProcessor<PSBTTypes>[] = [];

    constructor(authority: OPNetIdentity, db: ConfigurableDBManager, network: Network) {
        this.verificator.push(new UnwrapProcessor(authority, db, network));
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

        await Promise.all(promises);
    }
}
