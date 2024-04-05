import { BlockchainConfig, Logger } from '@btc-vision/motoswapcommon';
import { RPCClient } from 'rpc-bitcoin';
import { RPCIniOptions } from 'rpc-bitcoin/build/src/rpc.js';
import { BasicBlockInfo } from './types/BasicBlockInfo.js';
import { BitcoinChains, BlockchainInfo } from './types/BlockchainInfo.js';

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
