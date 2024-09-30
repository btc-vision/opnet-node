import { BlockDataWithTransactionData, BlockHeaderInfo } from '@btc-vision/bsi-bitcoin-rpc';
import { Logger } from '@btc-vision/bsi-common';
import { Config } from '../../../config/Config.js';

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
        if (!this.blockChangesSubscribers.length) {
            void this.watchBlockChanges();
        }

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

            return block;
        } catch (e: unknown) {
            const error = e as Error;
            this.error(`Error fetching block ${expectedBlockId}: ${error.message}`);

            throw e;
        }
    }

    protected notifyBlockChangesSubscribers(blockHeight: BlockHeaderInfo): void {
        this.blockChangesSubscribers.forEach((cb) => cb(blockHeight));
    }

    protected abstract queryBlockHeight(): Promise<bigint>;

    protected abstract watchBlockChanges(): Promise<void>;

    protected abstract queryBlock(
        blockHeightInProgress: bigint,
    ): Promise<BlockDataWithTransactionData | null>;
}
