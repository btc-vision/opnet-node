import { BlockchainConfig, Logger } from '@btc-vision/motoswapcommon';
import { RPCClient } from 'rpc-bitcoin';
import { GetBlockFilterParams, GetBlockHeaderParams, GetBlockParams, GetBlockStatsParams, GetChainTxStatsParams, Height, RPCIniOptions } from 'rpc-bitcoin/build/src/rpc.js';
import { BasicBlockInfo } from './types/BasicBlockInfo.js';
import { BitcoinChains, BlockchainInfo } from './types/BlockchainInfo.js';
import { BlockData, BlockDataWithTransactionData } from './types/BlockData.js';
import { BlockFilterInfo } from './types/BlockFilterInfo.js';
import { BlockHeaderInfo } from './types/BlockHeaderInfo.js';
import { BlockStats } from './types/BlockStats.js';
import { ChainTipInfo } from './types/ChainTipInfo.js';
import { ChainTxStats } from './types/ChainTxStats.js';

export class BitcoinRPC extends Logger {
    public readonly logColor: string = '#fa9600';

    private rpc: RPCClient | null = null;

    private blockchainInfo: BlockchainInfo | null = null;
    private currentBlockInfo: BasicBlockInfo | null = null;

    constructor() {
        super();

        this.purgeCachedData();
    }

    private purgeCachedData(): void {
        setInterval(() => {
            this.blockchainInfo = null;
            this.currentBlockInfo = null;
        }, 12000);
    }

    public getRpcConfigFromBlockchainConfig(rpcInfo: BlockchainConfig): RPCIniOptions {
        return {
            url: `http://${rpcInfo.BITCOIND_HOST}`,
            port: rpcInfo.BITCOIND_PORT,
            user: rpcInfo.BITCOIND_USERNAME,
            pass: rpcInfo.BITCOIND_PASSWORD,
        };
    }

    public async getBestBlockHash(): Promise<string> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const bestBlockHash = await this.rpc.getbestblockhash();
        return bestBlockHash;
    }

    public async getBlockAsHexString(blockHash: string): Promise<string | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: GetBlockParams = {
            blockhash: blockHash,
            verbosity: 0
        };

        const blockData: string = await this.rpc.getblock(param) as string;
        return blockData == '' ? null : blockData;
    }

    public async getBlockInfoOnly(blockHash: string): Promise<BlockData> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: GetBlockParams = {
            blockhash: blockHash,
            verbosity: 1
        };

        const blockData: BlockData = await this.rpc.getblock(param);
        return blockData;
    }

    public async getBlockInfoWithTransactionData(blockHash: string): Promise<BlockDataWithTransactionData> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: GetBlockParams = {
            blockhash: blockHash,
            verbosity: 2
        };

        const blockData: BlockDataWithTransactionData = await this.rpc.getblock(param);
        return blockData;
    }

    public async getBlockCount(): Promise<number> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const blockCount: number = await this.rpc.getblockcount();
        return blockCount;
    }

    public async getBlockFilter
        (
            blockHash: string,
            filterType?: string
        ): Promise<BlockFilterInfo> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }
        const param: GetBlockFilterParams = {
            blockhash: blockHash,
            filtertype: filterType
        };

        const result: BlockFilterInfo = await this.rpc.getblockfilter(param);
        return result;
    }

    public async getBlockHash(height: number): Promise<string> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: Height = {
            height: height
        };

        const result: string = await this.rpc.getblockhash(param);
        return result;
    }

    public async getChainInfo(): Promise<BlockchainInfo | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        this.blockchainInfo = await this.rpc.getblockchaininfo();
        if (this.blockchainInfo) {
            this.currentBlockInfo = {
                blockHeight: this.blockchainInfo.blocks,
                blockHash: this.blockchainInfo.bestblockhash,
            };
        }

        return this.blockchainInfo;
    }

    public async getBlockHeight(): Promise<BasicBlockInfo | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        if (!this.currentBlockInfo) {
            await this.getChainInfo();
        }

        return this.currentBlockInfo;
    }

    public async getBlockHeader
        (
            blockHash: string,
            verbose?: boolean
        ): Promise<BlockHeaderInfo | string> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: GetBlockHeaderParams = {
            blockhash: blockHash,
            verbose: verbose
        };

        const header: BlockHeaderInfo | string  = await this.rpc.getblockheader(param);
        
        return header;
    }

    public async getBlockStatsByHeight
    (
        height: number,
        stats?: string[]
    ): Promise<BlockStats> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: GetBlockStatsParams = {
            hash_or_height: height,
            stats: stats
        };

        const blockStats : BlockStats = await this.rpc.getblockstats(param);

        return blockStats;
    }

    public async getBlockStatsByHash
    (
        blockHash: string,
        stats?: string[]
    ): Promise<BlockStats> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: GetBlockStatsParams = {
            hash_or_height: blockHash,
            stats: stats
        };

        const blockStats: BlockStats = await this.rpc.getblockstats(param);

        return blockStats;
    }

    public async getChainTips(): Promise<ChainTipInfo[]> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const tips: ChainTipInfo[] = await this.rpc.getchaintips();

        return tips;
    }

    public async getChainTxStats
    (
        nblocks?: number,
        blockHash?: string
    ): Promise<ChainTxStats> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: GetChainTxStatsParams = {
            blockhash: blockHash,
            nblocks: nblocks
        };

        const chainTxStats: ChainTxStats = await this.rpc.getchaintxstats(param);

        return chainTxStats;
    }

    public async getDifficulty(): Promise<number> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const difficulty: number = await this.rpc.getdifficulty();

        return difficulty;
    }



    private async testRPC(rpcInfo: BlockchainConfig): Promise<void> {
        try {
            const chainInfo = await this.getChainInfo();
            if (!chainInfo) {
                this.error('RPC errored. Please check your configuration.');
                process.exit(1);
            }

            const chain = chainInfo.chain;
            if (BitcoinChains.MAINNET !== chain && rpcInfo.BITCOIND_NETWORK === 'mainnet') {
                this.error('Chain is not mainnet. Please check your configuration.');
                process.exit(1);
            } else if (BitcoinChains.TESTNET !== chain && rpcInfo.BITCOIND_NETWORK === 'testnet') {
                this.error(
                    `Chain is not testnet (currently: ${chain} !== ${BitcoinChains.TESTNET}). Please check your configuration.`,
                );
                process.exit(1);
            } else {
                this.success(
                    `RPC initialized. {Chain: ${rpcInfo.BITCOIND_NETWORK}. Block height: ${chainInfo.blocks}}`,
                );
            }
        } catch (e: unknown) {
            const error = e as Error;
            this.error(`RPC errored. Please check your configuration. ${error.message}`);
        }
    }

    public async init(rpcInfo: BlockchainConfig): Promise<void> {
        if (this.rpc) {
            throw new Error('RPC already initialized');
        }

        const rpcConfig = this.getRpcConfigFromBlockchainConfig(rpcInfo);
        this.rpc = new RPCClient(rpcConfig);

        await this.testRPC(rpcInfo);
    }
}
