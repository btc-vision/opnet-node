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
        //const a = await this.queryBlocks(blockHeight);
        //console.log(a);

        const blockHash: string | null = await this.rpc.getBlockHash(Number(blockHeight));
        if (blockHash == null) {
            throw new Error(`Error fetching block ${blockHeight}.`);
        }

        const resp = await this.rpc.getBlockInfoWithTransactionData(blockHash);
        if (resp) {
            await this.processResponse(resp);
        }

        return resp;
    }

    protected async processResponse(response: BlockDataWithTransactionData): Promise<void> {
        const txs = response.tx;
        if (response && txs && txs.length && !txs[0].hex) {
            const rawTxs = await this.rpc.getRawTransactions(
                txs.map((tx) => tx.txid),
                BitcoinVerbosity.NONE,
            );

            if (!rawTxs) {
                throw new Error('Error fetching raw transactions');
            }

            for (let i = 0; i < rawTxs.length; i++) {
                const t: TransactionDetail = rawTxs[i] as TransactionDetail;
                if (!t) {
                    continue;
                }

                response.tx[i] = t as TransactionData;
            }
        }
    }

    protected async processMultipleResponses(
        responses: (BlockDataWithTransactionData | null)[],
    ): Promise<void> {
        const txs: TransactionData[] = [];
        for (let i = 0; i < responses.length; i++) {
            const response = responses[i];
            if (!response) {
                continue;
            }

            const tx = response.tx;
            if (tx && tx.length && !tx[0].hex) {
                txs.push(...tx);
            }
        }

        const txids = txs.map((tx) => tx.txid);
        const rawTxs = await this.rpc.getRawTransactions(txids, BitcoinVerbosity.NONE);
        if (!rawTxs) {
            throw new Error('Error fetching raw transactions');
        }

        for (let i = 0; i < rawTxs.length; i++) {
            const t: TransactionDetail = rawTxs[i] as TransactionDetail;
            if (!t) {
                continue;
            }

            const tx = txs[i];
            if (tx) {
                txs[i].hex = t.hex;
            }
        }
    }

    protected async queryBlocks(
        blockHeight: bigint,
        batchSize: number = 100,
    ): Promise<BlockDataWithTransactionData[] | null> {
        const blockHashes: (string | null)[] | null = await this.rpc.getBlockHashes(
            Number(blockHeight.toString()),
            batchSize,
        );

        if (blockHashes === null) {
            throw new Error(`Error fetching block ${blockHeight}.`);
        }

        const finalHashes: string[] = blockHashes.filter((hash) => hash !== null);
        const resp = await this.rpc.getBlocksInfoWithTransactionData(finalHashes);

        const finalResp: BlockDataWithTransactionData[] = [];
        if (resp) {
            await this.processMultipleResponses(resp);

            for (let i = 0; i < resp.length; i++) {
                const response = resp[i];
                if (!response) {
                    continue;
                }

                finalResp.push(response);
            }
        }

        return finalResp;
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
