import { BlockFetcher, BlockFetcherConfiguration } from './abstract/BlockFetcher.js';
import {
    BitcoinRPC,
    BitcoinVerbosity,
    BlockDataWithTransactionData,
    TransactionData,
    TransactionDetail,
} from '@btc-vision/bsi-bitcoin-rpc';
import { Config } from '../../config/Config.js';

export interface RPCBlockFetcherConfiguration extends BlockFetcherConfiguration {
    readonly rpc: BitcoinRPC;
}

export class RPCBlockFetcher extends BlockFetcher {
    private readonly rpc: BitcoinRPC;

    private syncBlockHash: string | null = null;

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

        const resp = await this.rpc.getBlockInfoWithTransactionData(blockHash);
        if (resp) {
            const txs = resp.tx;
            if (resp && txs && txs.length && !txs[0].hex) {
                const promises = txs.map(async (tx) => {
                    return await this.rpc.getRawTransaction({
                        txId: tx.txid,
                        //blockHash: blockHash,
                        verbose: BitcoinVerbosity.NONE,
                    });
                });

                //const d = Date.now();
                const rawTxs = await Promise.all(promises);
                for (let i = 0; i < rawTxs.length; i++) {
                    const t: TransactionDetail = rawTxs[i] as TransactionDetail;
                    if (!t) {
                        continue;
                    }

                    resp.tx[i] = t as TransactionData;
                }
                //console.log(`Fetched ${rawTxs.length} raw transactions in ${Date.now() - d}ms.`);
            }
        }

        return resp;
    }

    protected async watchBlockChanges(): Promise<void> {
        try {
            const currentBlockHeight = await this.rpc.getBlockHeight();
            if (!currentBlockHeight) {
                throw new Error('Error fetching block height.');
            }

            const blockHeader = await this.rpc.getBlockHeader(currentBlockHeight.blockHash);
            if (!blockHeader) {
                throw new Error(
                    `Error fetching block header (hash: ${currentBlockHeight.blockHash}).`,
                );
            }

            if (this.syncBlockHash !== blockHeader.hash) {
                this.syncBlockHash = blockHeader.hash;
                this.notifyBlockChangesSubscribers(blockHeader);
            }
        } catch (e) {
            const error = e as Error;

            this.fail(`Error fetching block height: ${error.message}`);
        }

        setTimeout(async () => {
            await this.watchBlockChanges();
        }, Config.INDEXER.BLOCK_QUERY_INTERVAL);
    }

    protected async queryBlockHeight(): Promise<bigint> {
        const blockHeight = await this.rpc.getBlockHeight();
        if (blockHeight == null) {
            throw new Error('Error fetching block height.');
        }

        return BigInt(blockHeight.blockHeight);
    }
}
