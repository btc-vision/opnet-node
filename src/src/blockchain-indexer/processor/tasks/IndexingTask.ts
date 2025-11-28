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
import { Network } from '@btc-vision/bitcoin';
import { VMManager } from '../../../vm/VMManager.js';
import { SpecialManager } from '../special-transaction/SpecialManager.js';
import { BlockGasPredictor } from '../gas/BlockGasPredictor.js';
import { EpochManager } from '../epoch/EpochManager.js';
import { IMempoolTransactionObj } from '../../../db/interfaces/IMempoolTransaction.js';
import { Transaction } from '../transaction/Transaction.js';
import { OPNetTransactionTypes } from '../transaction/enums/OPNetTransactionTypes.js';

interface DummyTxInput {
    transactionId: string;
    outputIndex: number;
}

interface DummyMempoolTx {
    id: string;
    inputs: DummyTxInput[];
}

const BATCH_SIZE = 500;

export class IndexingTask extends Logger {
    public readonly logColor: string = '#9545c5';

    public _blockHash: string | null = null;
    public chainReorged: boolean = false;

    private prefetchPromise: Promise<Error | undefined> | null = null;
    private prefetchResolver: ((error?: Error) => void) | null = null;

    private prefetchStart: number = 0;
    private prefetchEnd: number = 0;

    private processedAt: number = 0;

    private finalizeBlockStart: number = 0;
    private finalizeEnd: number = 0;

    private downloadStart: number = 0;
    private downloadEnd: number = 0;

    private startPrepare: number = 0;
    private endPrepare: number = 0;

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

        // Register our abort handler
        this.abortController.signal.addEventListener('abort', this.onAbortHandler);
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
    ) => Promise<ThreadData | null> | null = () => {
        throw new Error('sendMessageToThread not implemented.');
    };

    public onComplete: () => Promise<void> | void = () => {
        throw new Error('onComplete not implemented.');
    };

    public verifyReorg: () => Promise<boolean> | boolean = () => {
        throw new Error('verifyReorg not implemented.');
    };

    public destroy(): void {
        // Avoid calls after we've already destroyed
        if (!this._abortController) {
            return;
        }

        // Remove the abort event listener
        this.abortController.signal.removeEventListener('abort', this.onAbortHandler);

        // Null out references
        this._abortController = null;
        this.sendMessageToThread = () => null;
        this.onComplete = () => void 0;
        this.verifyReorg = () => true;

        this.clear();
    }

    public async process(epochManager: EpochManager): Promise<void> {
        this.processedAt = Date.now();

        if (!this.prefetchPromise) {
            throw new Error('Prefetch promise not set');
        }

        try {
            // Wait for the prefetch to complete
            this.startPrepare = Date.now();

            const [response, challengeSolutions] = await Promise.safeAll([
                this.prefetchPromise,
                this.vmStorage.getChallengeSolutionsAtHeight(this.tip),
            ]);

            this.prefetchPromise = null;
            if (response) {
                this.error(`Error while prefetching block ${this.tip}: ${response.stack}`);
                throw response;
            }

            this.block.setChallengeSolutions(challengeSolutions);
            this.block.prepare();
            this.endPrepare = Date.now();

            // Process block
            await this.processBlock(epochManager);

            // If the block was reverted
            if (this.block.reverted) {
                throw new Error('Block reverted');
            }

            this.finalizeBlockStart = Date.now();

            // Get transaction data we'll need
            const blockTxs = this.block.getTransactions();
            const blockTxHashes = this.block.getTransactionsHashes();

            // Create a set for fast lookup of already deleted transactions
            const deletedTxIds = new Set<string>(blockTxHashes);

            // Execute operations in the correct sequence
            await this.vmStorage.deleteTransactionsById(blockTxHashes);

            const [finalizationResult] = await Promise.all([
                this.block.finalizeBlock(this.vmManager),
                this.detectAndRemoveConflictingTransactions(blockTxs, deletedTxIds),
            ]);

            this.finalizeEnd = Date.now();

            this.block.verifyIfBlockAborted();

            if (this.aborted) {
                return;
            }

            // Verify finalization
            if (!finalizationResult) {
                throw new Error('Block finalization failed');
            }

            // Notify chain observer
            await this.onComplete();
        } catch (e) {
            this.destroy();

            throw e;
        }

        if (Config.DEBUG_LEVEL >= DebugLevel.WARN) {
            const processEndTime = Date.now();
            const scale = BlockGasPredictor.scalingFactor / 100_000n;
            const lightOrange = this.chalk.hex('#ffa943');
            const pinkLog = this.chalk.hex('#e56ee5');

            const gasLog = pinkLog(
                `${(Number(this.block.baseGas / scale) / 100000).toFixed(6)}x/gas/sat (${lightOrange(`used ${this.block.gasUsed}`)})`,
            );

            this.info(
                `Block ${this.tip} processed (${pinkLog(`${processEndTime - this.processedAt}ms`)}). ` +
                    `{Transaction(s): ${pinkLog(`${this.block.header.nTx}`)} | Prepare: ${pinkLog(`${this.endPrepare - this.startPrepare} ms`)} | Base Gas: ${gasLog} | ` +
                    `EMA: ${this.block.ema} | Download: ${pinkLog(`${this.downloadEnd - this.downloadStart}ms`)} | ` +
                    `Deserialize: ${pinkLog(`${this.prefetchEnd - this.prefetchStart}ms`)} | ` +
                    `Finalize: ${pinkLog(`${this.finalizeEnd - this.finalizeBlockStart}ms`)} | ` +
                    `Execution: ${pinkLog(`${this.block.timeForTransactionExecution}ms`)} | ` +
                    `States: ${pinkLog(`${this.block.timeForStateUpdate}ms`)} | ` +
                    `Processing: ${pinkLog(`${this.block.timeForBlockProcessing}ms`)}}`,
            );
        }
    }

    public async cancel(reorged: boolean): Promise<void> {
        this.chainReorged = reorged;
        if (this._abortController) {
            this.abortController.abort('Task cancelled');
        }

        // Wait until prefetch completes if any
        if (this.prefetchPromise) {
            await this.prefetchPromise;
        }

        this.destroy();
    }

    public prefetch(): void {
        if (Config.DEBUG_LEVEL > DebugLevel.DEBUG) {
            this.debug(`Prefetching block ${this.tip}`);
        }

        this.prefetchPromise = new Promise<Error | undefined>(
            (resolve: (error?: Error) => void) => {
                this.prefetchResolver = (error?: Error) => {
                    this.prefetchResolver = null;
                    resolve(error);
                };

                void this.processPrefetch();
            },
        );
    }

    private async detectAndRemoveConflictingTransactions(
        blockTxs: Transaction<OPNetTransactionTypes>[],
        alreadyDeletedTxIds: Set<string>,
    ): Promise<void> {
        if (blockTxs.length === 0) {
            return;
        }

        const conflictIds = new Set<string>();

        for (let i = 0; i < blockTxs.length; i += BATCH_SIZE) {
            const batch = blockTxs.slice(i, Math.min(i + BATCH_SIZE, blockTxs.length));

            const batchDummies: DummyMempoolTx[] = batch.map((tx) => ({
                id: tx.transactionIdString,
                inputs: tx.inputs.map((input) => ({
                    transactionId: input.originalTransactionId.toString('hex'),
                    outputIndex: input.outputTransactionIndex,
                })) as DummyTxInput[],
            }));

            const batchPromises = batchDummies.map(async (dummy) => {
                try {
                    const conflicts = await this.vmStorage.findConflictingTransactions(
                        dummy as unknown as IMempoolTransactionObj,
                    );
                    return conflicts.map((c) => c.id);
                } catch (error) {
                    this.error(`Failed to detect conflicts for tx ${dummy.id}: ${error}`);
                    return [];
                }
            });

            const batchResults = await Promise.all(batchPromises);

            for (const ids of batchResults) {
                for (const id of ids) {
                    if (!alreadyDeletedTxIds.has(id)) {
                        conflictIds.add(id);
                    }
                }
            }

            if (this.aborted) {
                throw new Error('Conflict detection aborted');
            }
        }

        if (conflictIds.size > 0) {
            await this.vmStorage.deleteTransactionsById(Array.from(conflictIds));

            if (Config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                this.debug(`Removed ${conflictIds.size} conflicting transactions from mempool`);
            }
        }
    }

    private onAbortHandler = () => {
        if (this.prefetchPromise && this.prefetchResolver) {
            this.prefetchResolver(new Error('Task aborted'));
        }
    };

    private async processBlock(epochManager: EpochManager): Promise<void> {
        // Define consensus block height
        const cannotProceed = this.consensusTracker.setConsensusBlockHeight(this.tip);
        if (cannotProceed) {
            throw new Error('Consensus block height not set');
        }

        try {
            this.vmManager.prepareBlock(this.tip);

            // Save generic transactions
            this.block.insertPartialTransactions(this.vmManager);

            // Process the block
            await this.block.execute(this.vmManager, this.specialTransactionManager);

            // Update epoch submissions
            await this.block.processSubmissions(this.vmManager, epochManager);
        } catch (e) {
            await this.revertBlock(e as Error);

            throw e;
        } finally {
            // Reset
            this.specialTransactionManager.reset();
        }

        if (!this.chainReorged) {
            // Verify reorg
            this.chainReorged = await this.verifyReorg();
        }
    }

    private async revertBlock(error: Error): Promise<void> {
        await this.vmStorage.killAllPendingWrites();

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

        if (!this._abortController) {
            throw new Error('Error while fetching block.');
        }

        this.prefetchStart = Date.now();

        return new Block({
            ...blockData,
            network: this.network,
            abortController: this._abortController,
        });
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
                this.error(`Error processing block ${this.tip}: ${(e as Error).stack}`);
            }
        }
    }
}
