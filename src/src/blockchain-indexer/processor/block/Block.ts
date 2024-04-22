import { BlockDataWithTransactionData } from '@btc-vision/bsi-bitcoin-rpc';
import { Logger } from '@btc-vision/bsi-common';

export class Block extends Logger {
    constructor(protected readonly rawBlockData: BlockDataWithTransactionData) {
        super();
    }

    public get hash(): string {
        return this.rawBlockData.hash;
    }

    public get height(): number {
        return this.rawBlockData.height;
    }

    public async process(): Promise<void> {
        this.info(`Processing block ${this.hash} at height ${this.height}`);
    }
}
