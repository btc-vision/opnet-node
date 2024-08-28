import { BlockFetcher, BlockFetcherConfiguration } from './abstract/BlockFetcher.js';
import { BitcoinRPC, BlockDataWithTransactionData } from '@btc-vision/bsi-bitcoin-rpc';

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
}
