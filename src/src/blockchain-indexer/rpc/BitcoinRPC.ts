import { BlockchainConfig, Logger } from '@btc-vision/motoswapcommon';
import { RPCClient } from 'rpc-bitcoin';
import {
    Blockhash,
    CreateWalletParams,
    GetBlockFilterParams,
    GetBlockHeaderParams,
    GetBlockParams,
    GetBlockStatsParams,
    GetChainTxStatsParams,
    GetMemPoolParams,
    GetRawTransactionParams,
    GetTxOutParams,
    GetTxOutProofParams,
    Height,
    RPCIniOptions,
    SendRawTransactionParams,
    TxId,
    Verbose,
} from 'rpc-bitcoin/build/src/rpc.js';
import { AddressByLabel } from './types/AddressByLabel.js';

import { BasicBlockInfo } from './types/BasicBlockInfo.js';
import { BitcoinRawTransactionParams, RawTransaction } from './types/BitcoinRawTransaction.js';
import { BitcoinVerbosity } from './types/BitcoinVerbosity.js';
import { BitcoinChains, BlockchainInfo } from './types/BlockchainInfo.js';
import { BlockData, BlockDataWithTransactionData } from './types/BlockData.js';
import { BlockFilterInfo } from './types/BlockFilterInfo.js';
import { BlockHeaderInfo } from './types/BlockHeaderInfo.js';
import { BlockStats } from './types/BlockStats.js';
import { ChainTipInfo } from './types/ChainTipInfo.js';
import { ChainTxStats } from './types/ChainTxStats.js';
import { CreateWalletResponse } from './types/CreateWalletResponse.js';
import { MempoolInfo } from './types/MempoolInfo.js';
import {
    MemPoolTransactionInfo,
    RawMemPoolTransactionInfo,
} from './types/MemPoolTransactionInfo.js';
import { TransactionOutputInfo } from './types/TransactionOutputInfo.js';
import { TransactionOutputSetInfo } from './types/TransactionOutputSetInfo.js';
import { WalletInfo } from './types/WalletInfo.js';

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

    public async getBestBlockHash(): Promise<string | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const bestBlockHash = await this.rpc.getbestblockhash().catch((e) => {
            this.error(`Error getting best block hash: ${e.stack || e.message}`);
            return '';
        });

        return bestBlockHash || null;
    }

    public async getBlockAsHexString(blockHash: string): Promise<string | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: GetBlockParams = {
            blockhash: blockHash,
            verbosity: BitcoinVerbosity.NONE,
        };

        const blockData: string = await this.rpc.getblock(param).catch((e) => {
            this.error(`Error getting block data: ${e.stack || e.message}`);
            return null;
        });

        return blockData == '' ? null : blockData;
    }

    public async getBlockInfoOnly(blockHash: string): Promise<BlockData | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: GetBlockParams = {
            blockhash: blockHash,
            verbosity: BitcoinVerbosity.RAW,
        };

        const blockData: BlockData = await this.rpc.getblock(param).catch((e) => {
            this.error(`Error getting block data: ${e.stack || e.message}`);
            return null;
        });

        return blockData || null;
    }

    public async getBlockInfoWithTransactionData(
        blockHash: string,
    ): Promise<BlockDataWithTransactionData | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: GetBlockParams = {
            blockhash: blockHash,
            verbosity: 2,
        };

        const blockData: BlockDataWithTransactionData = await this.rpc
            .getblock(param)
            .catch((e) => {
                this.error(`Error getting block data: ${e.stack || e.message}`);
                return null;
            });

        return blockData || null;
    }

    public async getBlockCount(): Promise<number | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const blockCount: number = await this.rpc.getblockcount().catch((e) => {
            this.error(`Error getting block count: ${e.stack || e.message}`);
            return 0;
        });

        return blockCount || null;
    }

    public async getBlockFilter(
        blockHash: string,
        filterType?: string,
    ): Promise<BlockFilterInfo | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }
        const param: GetBlockFilterParams = {
            blockhash: blockHash,
            filtertype: filterType,
        };

        const result: BlockFilterInfo = await this.rpc.getblockfilter(param).catch((e) => {
            this.error(`Error getting block filter: ${e.stack || e.message}`);
            return null;
        });

        return result || null;
    }

    public async getBlockHash(height: number): Promise<string | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: Height = {
            height: height,
        };

        const result: string = await this.rpc.getblockhash(param).catch((e) => {
            this.error(`Error getting block hash: ${e.stack || e.message}`);
            return '';
        });

        return result || null;
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

    public async getWalletInfo(walletName: string): Promise<WalletInfo | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const walletInfo: WalletInfo = await this.rpc.getwalletinfo(walletName).catch((e) => {
            this.error(`Error getting wallet info: ${e.stack || e.message}`);
            return null;
        });

        return walletInfo || null;
    }

    public async createWallet(params: CreateWalletParams): Promise<CreateWalletResponse | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const wallet: CreateWalletResponse = await this.rpc.createwallet(params).catch((e) => {
            this.error(`Error creating wallet: ${e.stack || e.message}`);
            return '';
        });

        return wallet || null;
    }

    public async loadWallet(filename: string): Promise<CreateWalletResponse | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const params: { filename: string } = {
            filename,
        };

        const wallet: CreateWalletResponse = await this.rpc.loadwallet(params).catch((e) => {
            this.error(`Error loading wallet: ${e.stack || e.message}`);
            return '';
        });

        return wallet || null;
    }

    public async listWallets(): Promise<string[] | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const wallets: string[] = await this.rpc.listwallets().catch((e) => {
            this.error(`Error listing wallets: ${e.stack || e.message}`);
            return [];
        });

        return wallets || null;
    }

    public async getNewAddress(label: string, wallet?: string): Promise<string | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const params: { label: string } = {
            label,
        };

        const address: string = await this.rpc.getnewaddress(params, wallet).catch((e) => {
            this.error(`Error getting new address: ${e.stack || e.message}`);
            return '';
        });

        return address || null;
    }

    public async generateToAddress(
        nBlock: number,
        address: string,
        wallet?: string,
    ): Promise<string[] | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const params: { nblocks: number; address: string } = {
            nblocks: nBlock,
            address,
        };

        const blockHashes: string[] = await this.rpc
            .generatetoaddress(params, wallet)
            .catch((e) => {
                this.error(`Error generating to address: ${e.stack || e.message}`);
                return [];
            });

        return blockHashes || null;
    }

    public async importPrivateKey(
        privateKey: string,
        label: string,
        rescan?: boolean,
        wallet?: string,
    ): Promise<void> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const params: { privkey: string; label: string; rescan?: boolean } = {
            privkey: privateKey,
            label,
            rescan,
        };

        await this.rpc.importprivkey(params, wallet).catch((e) => {
            this.error(`Error importing private key: ${e.stack || e.message}`);
        });
    }

    public async getAddressByLabel(label: string, wallet?: string): Promise<AddressByLabel | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const params: { label: string } = {
            label,
        };

        const address: AddressByLabel = await this.rpc
            .getaddressesbylabel(params, wallet)
            .catch((e) => {
                this.error(`Error getting address by label: ${e.stack || e.message}`);
                return '';
            });

        return address || null;
    }

    public async sendRawTransaction(params: SendRawTransactionParams): Promise<string | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const txId: string = await this.rpc.sendrawtransaction(params).catch((e) => {
            this.error(`Error sending raw transaction: ${e.stack || e.message}`);
            return '';
        });

        return txId || null;
    }

    public async dumpPrivateKey(address: string, wallet?: string): Promise<string | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const privateKey: string = await this.rpc
            .dumpprivkey(
                {
                    address,
                },
                wallet,
            )
            .catch((e) => {
                this.error(`Error dumping private key: ${e.stack || e.message}`);
                return '';
            });

        return privateKey || null;
    }

    public async getRawTransaction<V extends BitcoinVerbosity>(
        parameters: BitcoinRawTransactionParams,
    ): Promise<RawTransaction<V> | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const params: GetRawTransactionParams = {
            txid: parameters.txId,
            verbose: parameters.verbose !== BitcoinVerbosity.RAW,
        };

        if (parameters.blockHash) {
            params.blockhash = parameters.blockHash;
        }

        const rawTx: RawTransaction<V> = await this.rpc.getrawtransaction(params).catch((e) => {
            this.error(`Error getting raw transaction: ${e.stack || e.message}`);
            return null;
        });

        return rawTx || null;
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

    public async getBlockHeader(
        blockHash: string,
        verbose?: boolean,
    ): Promise<BlockHeaderInfo | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: GetBlockHeaderParams = {
            blockhash: blockHash,
            verbose: verbose,
        };

        const header: BlockHeaderInfo = await this.rpc.getblockheader(param).catch((e) => {
            this.error(`Error getting block header: ${e.stack || e.message}`);
            return '';
        });

        return header || null;
    }

    public async getBlockStatsByHeight(
        height: number,
        stats?: string[],
    ): Promise<BlockStats | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: GetBlockStatsParams = {
            hash_or_height: height,
            stats: stats,
        };

        const blockStats: BlockStats = await this.rpc.getblockstats(param).catch((e) => {
            this.error(`Error getting block stats: ${e.stack || e.message}`);
            return null;
        });

        return blockStats || null;
    }

    public async getBlockStatsByHash(
        blockHash: string,
        stats?: string[],
    ): Promise<BlockStats | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: GetBlockStatsParams = {
            hash_or_height: blockHash,
            stats: stats,
        };

        const blockStats: BlockStats = await this.rpc.getblockstats(param).catch((e) => {
            this.error(`Error getting block stats: ${e.stack || e.message}`);
            return null;
        });

        return blockStats || null;
    }

    public async getChainTips(): Promise<ChainTipInfo[] | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const tips: ChainTipInfo[] = await this.rpc.getchaintips().catch((e) => {
            this.error(`Error getting chain tips: ${e.stack || e.message}`);
            return null;
        });

        return tips || null;
    }

    public async getChainTxStats(param: GetChainTxStatsParams): Promise<ChainTxStats | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const chainTxStats: ChainTxStats = await this.rpc.getchaintxstats(param).catch((e) => {
            this.error(`Error getting chain tx stats: ${e.stack || e.message}`);
            return null;
        });

        return chainTxStats || null;
    }

    public async getDifficulty(): Promise<number | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const difficulty: number = await this.rpc.getdifficulty().catch((e) => {
            this.error(`Error getting difficulty: ${e.stack || e.message}`);
            return 0;
        });

        return difficulty || null;
    }

    public async getMempoolAncestors<V extends BitcoinVerbosity>(
        txId: string,
        verbose?: V,
    ): Promise<MemPoolTransactionInfo<V> | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: GetMemPoolParams = {
            txid: txId,
            verbose: verbose !== BitcoinVerbosity.RAW,
        };

        const transactionInfo: MemPoolTransactionInfo<V> = await this.rpc
            .getmempoolancestors(param)
            .catch((e) => {
                this.error(`Error getting mempool ancestors: ${e.stack || e.message}`);
                return null;
            });

        return transactionInfo || null;
    }

    public async getMempoolDescendants<V extends BitcoinVerbosity>(
        txid: string,
        verbose?: V,
    ): Promise<MemPoolTransactionInfo<V> | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: GetMemPoolParams = {
            txid: txid,
            verbose: verbose !== BitcoinVerbosity.RAW,
        };

        const transactionInfo: MemPoolTransactionInfo<V> = await this.rpc
            .getmempooldescendants(param)
            .catch((e) => {
                this.error(`Error getting mempool descendants: ${e.stack || e.message}`);
                return null;
            });

        return transactionInfo || null;
    }

    public async getMempoolEntry(txid: string): Promise<RawMemPoolTransactionInfo | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: TxId = {
            txid: txid,
        };

        const transactionInfo: RawMemPoolTransactionInfo = await this.rpc
            .getmempoolentry(param)
            .catch((e) => {
                this.error(`Error getting mempool entry: ${e.stack || e.message}`);
                return null;
            });

        return transactionInfo || null;
    }

    public async getMempoolInfo(): Promise<MempoolInfo<BitcoinVerbosity.NONE> | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const mempoolInfo: MempoolInfo<BitcoinVerbosity.NONE> = await this.rpc
            .getmempoolinfo()
            .catch((e) => {
                this.error(`Error getting mempool info: ${e.stack || e.message}`);
                return null;
            });

        return mempoolInfo || null;
    }

    public async getRawMempool<V extends BitcoinVerbosity>(
        verbose?: V,
    ): Promise<MempoolInfo<V> | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: Verbose = {
            verbose: verbose !== BitcoinVerbosity.RAW,
        };

        const mempoolInfo: MempoolInfo<V> = await this.rpc.getrawmempool(param).catch((e) => {
            this.error(`Error getting raw mempool: ${e.stack || e.message}`);
            return null;
        });

        return mempoolInfo || null;
    }

    public async getTxOut(
        txid: string,
        voutNumber: number,
        includeMempool?: boolean,
    ): Promise<TransactionOutputInfo> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: GetTxOutParams = {
            n: voutNumber,
            txid: txid,
            include_mempool: includeMempool,
        };

        const txOuputInfo: TransactionOutputInfo = await this.rpc.gettxout(param).catch((e) => {
            this.error(`Error getting tx out: ${e.stack || e.message}`);
            return null;
        });

        return txOuputInfo || null;
    }

    public async getTxOutProof(txids: string[], blockHash?: string): Promise<string | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: GetTxOutProofParams = {
            txids: txids,
            blockhash: blockHash,
        };

        const txOuputProof: string = await this.rpc.gettxoutproof(param).catch((e) => {
            this.error(`Error getting tx out proof: ${e.stack || e.message}`);
            return '';
        });

        return txOuputProof || null;
    }

    public async getTxOutSetInfo(): Promise<TransactionOutputSetInfo | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const txOuputSetInfo: TransactionOutputSetInfo = await this.rpc
            .gettxoutsetinfo()
            .catch((e) => {
                this.error(`Error getting tx out set info: ${e.stack || e.message}`);
                return null;
            });

        return txOuputSetInfo || null;
    }

    public async preciousBlock(blockHash: string): Promise<void> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: Blockhash = {
            blockhash: blockHash,
        };

        await this.rpc.preciousblock(param).catch((e) => {
            this.error(`Error precious block: ${e.stack || e.message}`);
        });
    }

    public async pruneBlockChain(height: number): Promise<number | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: Height = {
            height: height,
        };

        const prunedHeight: number = await this.rpc.pruneblockchain(param).catch((e) => {
            this.error(`Error pruning blockchain: ${e.stack || e.message}`);
            return 0;
        });

        return prunedHeight || null;
    }

    public async saveMempool(): Promise<void> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        await this.rpc.savemempool().catch((e) => {
            this.error(`Error saving mempool: ${e.stack || e.message}`);
        });
    }

    public async verifyChain(checkLevel?: number, nblocks?: number): Promise<boolean | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: { checklevel?: number; nblocks?: number } = {
            checklevel: checkLevel,
            nblocks: nblocks,
        };

        const checked: boolean = await this.rpc.verifychain(param).catch((e) => {
            this.error(`Error verifying chain: ${e.stack || e.message}`);
            return false;
        });

        return checked || null;
    }

    public async verifyTxOutProof(proof: string): Promise<string[] | null> {
        if (!this.rpc) {
            throw new Error('RPC not initialized');
        }

        const param: { proof: string } = {
            proof: proof,
        };

        const proofs: string[] = await this.rpc.verifytxoutproof(param).catch((e) => {
            this.error(`Error verifying tx out proof: ${e.stack || e.message}`);
            return [];
        });

        return proofs || null;
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
            } else if (BitcoinChains.REGTEST !== chain && rpcInfo.BITCOIND_NETWORK === 'regtest') {
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
