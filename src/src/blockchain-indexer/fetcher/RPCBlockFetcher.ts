import { BlockFetcher, BlockFetcherConfiguration } from './abstract/BlockFetcher.js';
import { BitcoinRPC, BlockDataWithTransactionData } from '@btc-vision/bsi-bitcoin-rpc';
import { Config } from '../../config/Config.js';

export interface RPCBlockFetcherConfiguration extends BlockFetcherConfiguration {
    readonly rpc: BitcoinRPC;
}

export class RPCBlockFetcher extends BlockFetcher {
    private readonly rpc: BitcoinRPC;

    public constructor(config: RPCBlockFetcherConfiguration) {
        super(config);

        if (!config.rpc) {
            throw new Error('RPCBlockFetcher requires a BitcoinRPC instance');
        }

        this.rpc = config.rpc;
    }

    protected async queryBlock(blockHeight: bigint): Promise<BlockDataWithTransactionData | null> {
        const blockHash: string | null = await this.rpc.getBlockHash(Number(blockHeight));
        if (blockHash == null) {
            throw new Error(`Error fetching block ${blockHeight}.`);
        }

        return await this.rpc.getBlockInfoWithTransactionData(blockHash);
    }

    protected async watchBlockChanges(): Promise<void> {
        try {
            const currentBlockHeight = await this.rpc.getBlockHeight();
            if (!currentBlockHeight) {
                throw new Error('Error fetching block height.');
            }

            this.info(
                `Current block height: ${currentBlockHeight.blockHeight} (${currentBlockHeight.blockHash})`,
            );

            const blockHeader = await this.rpc.getBlockHeader(currentBlockHeight.blockHash);
            if (!blockHeader) {
                throw new Error(
                    `Error fetching block header (hash: ${currentBlockHeight.blockHash}).`,
                );
            }

            this.notifyBlockChangesSubscribers(blockHeader);
        } catch (e) {
            const error = e as Error;

            this.fail(`Error fetching block height: ${error.message}`);
        }

        setTimeout(() => {
            this.watchBlockChanges();
        }, Config.INDEXER.BLOCK_QUERY_INTERVAL);
    }
}
