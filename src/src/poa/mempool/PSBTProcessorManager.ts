import { KnownPSBTObject } from './psbt/PSBTTransactionVerifier.js';
import { PSBTTypes } from './psbt/PSBTTypes.js';
import { PSBTProcessor } from './processor/PSBTProcessor.js';
import { ConfigurableDBManager } from '@btc-vision/bsi-common';
import { UnwrapProcessor } from './processor/UnwrapProcessor.js';
import { Network } from 'bitcoinjs-lib';
import { OPNetIdentity } from '../identity/OPNetIdentity.js';

export class PSBTProcessorManager {
    private readonly verificator: PSBTProcessor<PSBTTypes>[] = [];

    constructor(authority: OPNetIdentity, db: ConfigurableDBManager, network: Network) {
        this.verificator.push(new UnwrapProcessor(authority, db, network));
    }

    public async processPSBT(data: KnownPSBTObject): Promise<boolean> {
        const processor = this.verificator.find((v) => v.type === data.type);
        if (processor) {
            return await processor.process(data.psbt, data.data);
        }

        throw new Error('Unknown PSBT type');
    }

    public createRepositories(): void {
        this.verificator.forEach((v) => v.createRepositories());
    }
}
