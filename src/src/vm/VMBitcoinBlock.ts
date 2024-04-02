import { Logger } from '@btc-vision/motoswapcommon';
import { VMStorage } from './storage/VMStorage.js';

export class VMBitcoinBlock extends Logger {
    public readonly logColor: string = '#ddff00';

    private isPrepared: boolean = false;

    constructor(
        public readonly blockId: bigint,
        private readonly vmStorage: VMStorage,
    ) {
        super();
    }

    public async prepare(): Promise<void> {
        if (this.isPrepared) {
            throw new Error(`Block ${this.blockId} is already prepared`);
        }

        this.log(`Preparing block ${this.blockId}...`);

        await this.vmStorage.prepareNewBlock();
    }

    public async revert(): Promise<void> {
        if (!this.isPrepared) {
            throw new Error(`Block ${this.blockId} is not prepared`);
        }

        this.log(`Reverting block ${this.blockId}...`);

        await this.vmStorage.revertChanges();
    }

    public async terminate(): Promise<void> {
        if (!this.isPrepared) {
            throw new Error(`Block ${this.blockId} is not prepared`);
        }

        this.log(`Terminating block ${this.blockId}...`);

        await this.vmStorage.terminateBlock();
    }
}
