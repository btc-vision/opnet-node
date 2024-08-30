import { BlockDataWithTransactionData, BlockHeaderInfo } from '@btc-vision/bsi-bitcoin-rpc';
import { Logger } from '@btc-vision/bsi-common';

export interface BlockFetcherConfiguration {
    readonly maximumPrefetchBlocks: number;
}

export abstract class BlockFetcher extends Logger {
    public readonly logColor: string = '#00ffe1';

    protected prefetchedBlocks: Map<bigint, Promise<BlockDataWithTransactionData | null>> =
        new Map();
    protected blockChangesSubscribers: ((newHeight: BlockHeaderInfo) => void)[] = [];

    private lastBlockHash: string | null = null;

    protected constructor(protected readonly config: BlockFetcherConfiguration) {
        super();
    }

    public subscribeToBlockChanges(cb: (newHeight: BlockHeaderInfo) => void): void {
        if (!this.subscribeToBlockChanges.length) {
            void this.watchBlockChanges();
        }

        this.blockChangesSubscribers.push(cb);
    }

    public async getBlock(
        expectedBlockId: bigint,
        chainCurrentBlockHeight: bigint,
    ): Promise<BlockDataWithTransactionData | null> {
        try {
            this.prefetchBlocks(expectedBlockId, chainCurrentBlockHeight);

            const block = await this.prefetchedBlocks.get(expectedBlockId);
            this.prefetchedBlocks.delete(expectedBlockId);

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

            return block;
        } catch (e) {
            let error = e as Error;
            this.error(`Error fetching block ${expectedBlockId}: ${error.message}`);

            this.purgePrefetchedBlocks();

            throw e;
        }
    }

    public purgePrefetchedBlocks(): void {
        this.prefetchedBlocks.clear();
    }

    public prefetchBlocks(blockHeightInProgress: bigint, chainCurrentBlockHeight: bigint): void {
        const blocksToPrefetch = BigInt(
            Math.min(
                this.config.maximumPrefetchBlocks - this.prefetchedBlocks.size,
                Number(chainCurrentBlockHeight - blockHeightInProgress),
            ),
        );

        const currentOffset = blockHeightInProgress + BigInt(this.prefetchedBlocks.size);
        for (let i = 0n; i < blocksToPrefetch; i++) {
            if (blockHeightInProgress + i > chainCurrentBlockHeight) {
                continue; // Stop prefetching if we reach the end of the chain
            }

            if (this.prefetchedBlocks.size >= this.config.maximumPrefetchBlocks) {
                this.warn(`Reached maximum prefetched blocks.`);
                break; // Stop prefetching if we reach the maximum prefetched blocks
            }

            const blockId = currentOffset + i;

            if (!this.prefetchedBlocks.has(blockId)) {
                this.info(`Prefetching block ${blockId}`);

                this.prefetchedBlocks.set(blockId, this.queryBlock(blockId));
            } else {
                this.info(`Block ${blockId} is already prefetched.`);
            }
        }

        /*if (this.prefetchedBlocks.size >= this.config.maximumPrefetchBlocks) {
            return;
        }


        this.log(
            `Prefetching ${blocksToPrefetch} blocks... {blockHeightInProgress: ${blockHeightInProgress}, chainCurrentBlockHeight: ${chainCurrentBlockHeight}}`,
        );

        if (blockHeightInProgress === chainCurrentBlockHeight) {
            this.prefetchedBlocks.set(
                blockHeightInProgress,
                this.queryBlock(blockHeightInProgress),
            );
        } else {
            const blockOffset = blockHeightInProgress + BigInt(this.prefetchedBlocks.size);
            for (let i = 0; i < blocksToPrefetch; i++) {
                if (chainCurrentBlockHeight < blockOffset + BigInt(i)) {
                    break;
                }

                const blockId = blockOffset + BigInt(i);

                this.prefetchedBlocks.set(blockId, this.queryBlock(blockId));
            }
        }*/
    }

    protected notifyBlockChangesSubscribers(blockHeight: BlockHeaderInfo): void {
        this.blockChangesSubscribers.forEach((cb) => cb(blockHeight));
    }

    protected abstract watchBlockChanges(): Promise<void>;

    protected abstract queryBlock(
        blockHeightInProgress: bigint,
    ): Promise<BlockDataWithTransactionData | null>;

    private max(a: bigint, b: bigint): bigint {
        return a > b ? a : b;
    }
}
