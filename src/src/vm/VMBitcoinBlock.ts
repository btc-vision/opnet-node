import { DebugLevel, Logger } from '@btc-vision/bsi-common';
import { Config } from '../config/Config.js';
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

    public prepare(blockId: bigint): void {
        if (this.isPrepared) {
            throw new Error(`The block ${this.blockId} is already prepared`);
        }

        this.blockId = blockId;

        if (Config.DEBUG_LEVEL > DebugLevel.TRACE) {
            this.log(`Preparing block ${this.blockId}...`);
        }

        this.isPrepared = true;
    }

    public revert(): void {
        if (!this.isPrepared) {
            throw new Error(`[REVERT] Block ${this.blockId} is not prepared`);
        }

        const blockId = this.blockId;
        this.error(`Reverting block ${blockId}...`);

        this.reset();
    }

    public terminate(): void {
        if (!this.isPrepared) {
            throw new Error(`[TERMINATE] Block ${this.blockId} is not prepared`);
        }

        if (Config.DEBUG_LEVEL > DebugLevel.TRACE) {
            this.log(`Terminating block ${this.blockId}...`);
        }

        const blockId = this.blockId;
        this.reset();
    }

    private reset(): void {
        this.isPrepared = false;

        this.blockId = 0n;
    }
}
