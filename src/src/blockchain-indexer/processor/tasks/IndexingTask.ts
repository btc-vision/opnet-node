import { ChainObserver } from '../observer/ChainObserver.js';
import { ConsensusTracker } from '../consensus/ConsensusTracker.js';
import { VMStorage } from '../../../vm/storage/VMStorage.js';
import { DebugLevel, Logger } from '@btc-vision/bsi-common';
import { ThreadTypes } from '../../../threading/thread/enums/ThreadTypes.js';
import { ThreadMessageBase } from '../../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { MessageType } from '../../../threading/enum/MessageType.js';
import { ThreadData } from '../../../threading/interfaces/ThreadData.js';
import { Config } from '../../../config/Config.js';
import { Block, DeserializedBlock } from '../block/Block.js';
import { Network } from 'bitcoinjs-lib';
import { VMManager } from '../../../vm/VMManager.js';
import { SpecialManager } from '../special-transaction/SpecialManager.js';

export class IndexingTask extends Logger {
    public readonly logColor: string = '#9545c5';

    public _blockHash: string | null = null;

    private prefetchPromise: Promise<Error | undefined> | null = null;
    private prefetchResolver: ((error?: Error) => void) | null = null;

    private prefetchStart: number = 0;
    private prefetchEnd: number = 0;
    private processedAt: number = 0;
    private finalizeBlockStart: number = 0;
    private finalizeEnd: number = 0;

    private downloadStart: number = 0;
    private downloadEnd: number = 0;

    public constructor(
        public readonly tip: bigint,
        private readonly network: Network,
        private readonly chainObserver: ChainObserver,
        private readonly consensusTracker: ConsensusTracker,
        private readonly vmStorage: VMStorage,
        private readonly vmManager: VMManager,
        private readonly specialTransactionManager: SpecialManager,
    ) {
        super();

        if (this.chainObserver.targetBlockHeight < this.tip) {
            throw new Error('Tip is greater than target block height');
        }

        this.abortController.signal.addEventListener('abort', () => {
            if (this.prefetchPromise && this.prefetchResolver) {
                this.prefetchResolver(new Error('Task aborted'));
            }
        });
    }

    private _block: Block | null = null;

    public get block(): Block {
        if (!this._block) {
            throw new Error('Task not processed.');
        }

        return this._block;
    }

    public get aborted(): boolean {
        return !this._abortController || this.abortController.signal.aborted;
    }

    private _abortController: AbortController | null = new AbortController();

    private get abortController(): AbortController {
        if (!this._abortController) {
            throw new Error('Abort controller not set');
        }

        return this._abortController;
    }

    public sendMessageToThread: (
        type: ThreadTypes,
        message: ThreadMessageBase<MessageType>,
    ) => Promise<ThreadData | null> = async () => {
        throw new Error('sendMessageToThread not implemented.');
    };

    public onComplete: () => Promise<void> = async () => {
        throw new Error('onComplete not implemented.');
    };

    public verifyReorg: () => Promise<boolean> = async () => {
        throw new Error('verifyReorg not implemented.');
    };

    public destroy(): void {
        this.sendMessageToThread = async () => null;
        this.onComplete = async () => void 0;
        this.verifyReorg = async () => true;

        this._abortController = null;

        this.clear();
    }

    public async refresh(): Promise<void> {
        if (this.abortController.signal.aborted) return;

        this.clear();

        await this.process();
    }

    public async process(): Promise<void> {
        this.processedAt = Date.now();

        if (!this.prefetchPromise) {
            throw new Error('Prefetch promise not set');
        }

        // Process task
        try {
            // First we wait for the prefetch to complete
            const response = await this.prefetchPromise.catch((error) => {
                throw error;
            });

            this.prefetchPromise = null;

            if (response) throw response;

            await this.processBlock();

            // Notify chain observer
            if (this.block.reverted) {
                throw new Error('Block reverted');
            }

            this.finalizeBlockStart = Date.now();

            // Finalize block
            const resp = await Promise.all([
                this.vmStorage.deleteTransactionsById(this.block.getTransactionsHashes()),
                this.block.finalizeBlock(this.vmManager),
            ]);

            this.finalizeEnd = Date.now();

            // Verify finalization
            if (resp[1] === false) {
                throw new Error('Block finalization failed');
            }

            // Notify chain observer
            await this.onComplete();
        } catch (e) {
            // Destroy task
            this.destroy();

            throw e;
        }

        const processEndTime = Date.now();
        if (Config.DEBUG_LEVEL >= DebugLevel.WARN) {
            this.info(
                `Block ${this.tip} processed successfully. {Transaction(s): ${this.block.header.nTx} | Download: ${this.downloadEnd - this.downloadStart}ms | Deserialize: ${this.prefetchEnd - this.prefetchStart}ms | Finalize: ${this.finalizeEnd - this.finalizeBlockStart}ms | Execution: ${this.block.timeForTransactionExecution}ms | States: ${this.block.timeForStateUpdate}ms | Processing: ${this.block.timeForBlockProcessing}ms | Complete: ${processEndTime - this.finalizeEnd}ms | Took: ${processEndTime - this.processedAt}ms})`,
            );
        }
    }

    public cancel(): void {
        this.abortController.abort('Task cancelled');

        this.destroy();
    }

    public prefetch(): void {
        if (Config.DEBUG_LEVEL > DebugLevel.DEBUG) {
            this.debug(`Prefetching block ${this.tip}`);
        }

        this.prefetchPromise = new Promise<Error | undefined>(
            async (resolve: (error?: Error) => void) => {
                this.prefetchResolver = (error?: Error) => {
                    this.prefetchResolver = null;

                    resolve(error);
                };

                await this.processPrefetch();
            },
        );
    }

    private async processBlock(): Promise<void> {
        // Define consensus block height
        this.consensusTracker.setConsensusBlockHeight(this.tip);

        try {
            await this.vmManager.prepareBlock(this.tip);

            // Save generic transactions
            await this.block.insertPartialTransactions(this.vmManager);

            // Process block.
            const success = await this.block.execute(
                this.vmManager,
                this.specialTransactionManager,
            );

            if (!success) {
                throw new Error('Block execution failed');
            }

            // Reset
            this.specialTransactionManager.reset();
        } catch (e) {
            await this.revertBlock(e as Error);

            this.specialTransactionManager.reset();

            throw e;
        }

        // Verify Reorg
        const hasReorged = await this.verifyReorg();
        if (hasReorged) {
            this.warn(`Chain reorg detected at block ${this.tip}`);

            await this.revertBlock(new Error('Chain reorg detected'));

            throw new Error('Chain reorg detected');
        }
    }

    private async revertBlock(error: Error): Promise<void> {
        await this.vmStorage.revertDataUntilBlock(this.tip);

        if (this._block) {
            await this.block.revertBlock(this.vmManager);
        } else {
            await this.vmManager.revertBlock();
        }

        throw new Error(`Block ${this.tip} reverted: ${error.stack}`);
    }

    private clear(): void {
        this._blockHash = null;
        this.prefetchPromise = null;
        this.prefetchResolver = null;
    }

    private async requestBlock(tip: bigint): Promise<Block> {
        this.downloadStart = Date.now();
        const blockData = (await this.sendMessageToThread(ThreadTypes.SYNCHRONISATION, {
            type: MessageType.DESERIALIZE_BLOCK,
            data: tip,
        })) as DeserializedBlock | { error: Error };
        this.downloadEnd = Date.now();

        if (!blockData) {
            throw new Error('Block data not found');
        }

        if ('error' in blockData) {
            throw blockData.error;
        }

        this.prefetchStart = Date.now();
        const block = new Block({
            ...blockData,
            network: this.network,
            abortController: this.abortController,
        });

        return block;
    }

    private async processPrefetch(): Promise<void> {
        if (!this.prefetchResolver) {
            throw new Error('Prefetch resolver not set');
        }

        try {
            // Create block
            const chainBlock = await this.requestBlock(this.tip);
            if (this.aborted) {
                throw new Error('Task aborted');
            }

            this._blockHash = chainBlock.hash;

            this._block = chainBlock;
            this.prefetchEnd = Date.now();
            this.prefetchResolver();
        } catch (e) {
            if (this.prefetchResolver) {
                const error = e as Error;
                this.prefetchResolver(error);
            } else {
                this.error(`Error processing block ${this.tip}: ${e}`);
            }
        }
    }
}
