import { Logger } from '@btc-vision/motoswapcommon';
import { VMStorage } from './storage/VMStorage.js';

export class VMBitcoinBlock extends Logger {
    public readonly logColor: string = '#ddff00';

    private isPrepared: boolean = false;
    private blockId: bigint = 0n;

    constructor(private readonly vmStorage: VMStorage) {
        super();
    }

    public async prepare(blockId: bigint): Promise<void> {
        this.blockId = blockId;

        if (this.isPrepared) {
            throw new Error(`Block ${this.blockId} is already prepared`);
        }

        if (this.blockId === 0n) {
            throw new Error(`Block ${this.blockId} is not valid`);
        }

        this.log(`Preparing block ${this.blockId}...`);

        await this.vmStorage.prepareNewBlock();

        this.isPrepared = true;
    }

    public async revert(): Promise<void> {
        if (!this.isPrepared) {
            throw new Error(`Block ${this.blockId} is not prepared`);
        }

        if (this.blockId === 0n) {
            throw new Error(`Block ${this.blockId} is not valid`);
        }

        this.log(`Reverting block ${this.blockId}...`);

        await this.vmStorage.revertChanges();
    }

    public async terminate(): Promise<void> {
        if (!this.isPrepared) {
            throw new Error(`Block ${this.blockId} is not prepared`);
        }

        if (this.blockId === 0n) {
            throw new Error(`Block ${this.blockId} is not valid`);
        }

        this.log(`Terminating block ${this.blockId}...`);

        await this.vmStorage.terminateBlock();

        this.blockId = 0n;
        this.isPrepared = false;
    }
}
