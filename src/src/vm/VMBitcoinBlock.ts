import { Logger } from '@btc-vision/bsi-common';
import { VMStorage } from './storage/VMStorage.js';

export class VMBitcoinBlock extends Logger {
    public readonly logColor: string = '#ddff00';

    private isPrepared: boolean = false;
    private blockId: bigint = 0n;

    constructor(private readonly vmStorage: VMStorage) {
        super();
    }

    public get height(): bigint {
        return this.blockId;
    }

    public async prepare(blockId: bigint): Promise<void> {
        if (this.isPrepared) {
            throw new Error(`The block ${this.blockId} is already prepared`);
        }

        this.blockId = blockId;

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

        this.error(`Reverting block ${this.blockId}...`);

        this.reset();
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

        this.reset();
        await this.vmStorage.terminateBlock();

        return;
    }

    private reset(): void {
        this.isPrepared = false;

        this.blockId = 0n;
    }
}
