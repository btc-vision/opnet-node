import { BlockDataWithTransactionData } from '@btc-vision/bsi-bitcoin-rpc';
import { Logger } from '@btc-vision/bsi-common';

export interface BlockFetcherConfiguration {
    readonly maximumPrefetchBlocks: number;
}

export abstract class BlockFetcher extends Logger {
    public readonly logColor: string = '#00ffe1';

    protected prefetchedBlocks: Promise<BlockDataWithTransactionData | null>[] = [];

    protected constructor(protected readonly config: BlockFetcherConfiguration) {
        super();
    }

    public async getBlock(
        expectedBlockId: bigint,
        chainCurrentBlockHeight: bigint,
    ): Promise<BlockDataWithTransactionData | null> {
        try {
            this.prefetchBlocks(expectedBlockId, chainCurrentBlockHeight);

            if (this.prefetchedBlocks.length === 0) {
                this.warn(
                    `Something went wrong with the prefetching of blocks. Fetching block ${expectedBlockId} directly...`,
                );

                return this.queryBlock(expectedBlockId);
            }

            const block = await this.prefetchedBlocks.shift();
            if (!block) {
                return null;
            }

            if (BigInt(block.height) !== expectedBlockId) {
                throw new Error(
                    `Block ${block.height} was fetched instead of the expected block ${expectedBlockId}.`,
                );
            }

            return block;
        } catch (e) {
            let error = e as Error;
            this.error(`Error fetching block ${expectedBlockId}: ${error.message}`);

            return null;
        }
    }

    public purgePrefetchedBlocks(): void {
        this.prefetchedBlocks = [];
    }

    protected abstract queryBlock(
        blockHeightInProgress: bigint,
    ): Promise<BlockDataWithTransactionData | null>;

    private prefetchBlocks(blockHeightInProgress: bigint, chainCurrentBlockHeight: bigint): void {
        if (this.prefetchedBlocks.length >= this.config.maximumPrefetchBlocks) {
            return;
        }

        const blocksToPrefetch = Math.min(
            this.config.maximumPrefetchBlocks - this.prefetchedBlocks.length,
            Number(chainCurrentBlockHeight - blockHeightInProgress),
        );

        const blockOffset = blockHeightInProgress + BigInt(this.prefetchedBlocks.length);
        this.log(`Prefetching ${blocksToPrefetch} blocks... {CurrentHeight: ${blockOffset}}`);

        for (let i = 0; i < blocksToPrefetch; i++) {
            this.prefetchedBlocks.push(this.queryBlock(blockOffset + BigInt(i)));
        }
    }
}
