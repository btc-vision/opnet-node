import { BlockDataWithTransactionData, BlockHeaderInfo } from '@btc-vision/bitcoin-rpc';
import { Logger } from '@btc-vision/bsi-common';
import { Config } from '../../../config/Config.js';
import { ZERO_HASH } from '../../processor/block/types/ZeroValue.js';

export interface BlockFetcherConfiguration {
    readonly maximumPrefetchBlocks: number;
}

export abstract class BlockFetcher extends Logger {
    public readonly logColor: string = '#00ffe1';

    protected blockChangesSubscribers: ((newHeight: BlockHeaderInfo) => void)[] = [];

    private lastBlockHash: string | null = null;

    protected constructor(protected readonly config: BlockFetcherConfiguration) {
        super();
    }

    public subscribeToBlockChanges(cb: (newHeight: BlockHeaderInfo) => void): void {
        this.blockChangesSubscribers.push(cb);
    }

    public async getChainHeight(): Promise<bigint> {
        return this.queryBlockHeight();
    }

    public async getBlock(expectedBlockId: bigint): Promise<BlockDataWithTransactionData | null> {
        try {
            const block = await this.queryBlock(expectedBlockId);
            if (!block) {
                return null;
            }

            if (BigInt(block.height) !== expectedBlockId) {
                throw new Error(
                    `Block ${block.height} was fetched instead of the expected block ${expectedBlockId}.`,
                );
            }

            if (this.lastBlockHash === block.hash) {
                throw new Error(`Block ${block.height} was fetched twice.`);
            }

            this.lastBlockHash = block.hash;

            // Sometimes, the emptiness feels heavier than the pain.
            if (Config.DEV.CAUSE_FETCHING_FAILURE && Math.random() > 0.95) {
                throw new Error('Random error');
            }

            if (
                block &&
                Math.random() < 0.5 &&
                expectedBlockId > 1n &&
                Config.DEV.ENABLE_REORG_NIGHTMARE
            ) {
                block.hash = ZERO_HASH;
            }

            return block;
        } catch (e: unknown) {
            const error = e as Error;
            this.error(`Error fetching block ${expectedBlockId}: ${error.message}`);

            throw e;
        }
    }

    /**
     * New method to fetch multiple blocks in a batch.
     * This wraps the abstract queryBlocks(...) method.
     */

    /*public async getBlocks(
        startHeight: bigint,
        batchSize = 10,
    ): Promise<BlockDataWithTransactionData[]> {
        try {
            const blocks = await this.queryBlocks(startHeight, batchSize);
            if (!blocks || blocks.length === 0) {
                throw new Error(
                    `No blocks returned for the batch (start=${startHeight}, size=${batchSize}).`,
                );
            }

            const finalBlocks: BlockDataWithTransactionData[] = [];

            for (let i = 0; i < blocks.length; i++) {
                const block = blocks[i];
                if (!block) {
                    // If you get null in the array, handle or skip it
                    this.warn(`Block at index ${i} from batch is null. Skipping...`);
                    continue;
                }

                // Verify the returned block's height is exactly (startHeight + i)
                const expectedHeight = startHeight + BigInt(i);
                if (BigInt(block.height) !== expectedHeight) {
                    throw new Error(
                        `Batch block mismatch: expected height ${expectedHeight}, got ${block.height}.`,
                    );
                }

                // Ensure we're not processing the same block twice
                if (this.lastBlockHash === block.hash) {
                    throw new Error(`Block ${block.height} was fetched twice in batch.`);
                }

                // Update lastBlockHash
                this.lastBlockHash = block.hash;

                // Optional random error injection for dev environment
                if (Config.DEV.CAUSE_FETCHING_FAILURE && Math.random() > 0.95) {
                    throw new Error(`Random error on block ${block.height} in batch.`);
                }

                finalBlocks.push(block);
            }

            // If for any reason finalBlocks is empty after filtering, you can handle that here
            if (finalBlocks.length === 0) {
                throw new Error(
                    `All blocks returned from [${startHeight}..${startHeight + BigInt(batchSize) - 1n}] were null or invalid.`,
                );
            }

            return finalBlocks;
        } catch (error) {
            const err = error as Error;
            this.error(
                `Error fetching blocks in range [${startHeight}..${
                    startHeight + BigInt(batchSize) - 1n
                }]: ${err.message}`,
            );
            throw err;
        }
    }*/

    public onReorg(): void {
        this.lastBlockHash = null;
    }

    public abstract watchBlockChanges(isFirst: boolean): Promise<void>;

    protected notifyBlockChangesSubscribers(blockHeight: BlockHeaderInfo): void {
        this.blockChangesSubscribers.forEach((cb) => cb(blockHeight));
    }

    protected abstract queryBlockHeight(): Promise<bigint>;

    protected abstract queryBlock(
        blockHeightInProgress: bigint,
    ): Promise<BlockDataWithTransactionData | null>;

    protected abstract queryBlocks(
        blockHeight: bigint,
        batchSize: number,
    ): Promise<BlockDataWithTransactionData[] | null>;
}
