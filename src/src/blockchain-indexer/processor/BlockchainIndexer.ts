import {
    BitcoinRPC,
    BlockchainInfo,
    BlockDataWithTransactionData,
} from '@btc-vision/bsi-bitcoin-rpc';
import { DebugLevel, Logger } from '@btc-vision/bsi-common';
import bitcoin from 'bitcoinjs-lib';
import { Config } from '../../config/Config.js';
import { DBManagerInstance } from '../../db/DBManager.js';
import { BlockchainInformationRepository } from '../../db/repositories/BlockchainInformationRepository.js';
import { VMManager } from '../../vm/VMManager.js';
import { Block } from './block/Block.js';

export class BlockchainIndexer extends Logger {
    public readonly logColor: string = '#00ff00';

    private readonly network: string;
    private readonly rpcClient: BitcoinRPC = new BitcoinRPC();

    private readonly bitcoinNetwork: bitcoin.networks.Network;

    private readonly vmManager: VMManager = new VMManager(Config);
    private readonly processOnlyOneBlock: boolean = false;

    private fatalFailure: boolean = false;

    constructor() {
        super();

        this.network = Config.BLOCKCHAIN.BITCOIND_NETWORK;

        switch (this.network) {
            case 'mainnet':
                this.bitcoinNetwork = bitcoin.networks.bitcoin;
                break;
            case 'testnet':
                this.bitcoinNetwork = bitcoin.networks.testnet;
                break;
            case 'regtest':
                this.bitcoinNetwork = bitcoin.networks.regtest;
                break;
            default:
                throw new Error(`Invalid network ${this.network}`);
        }
    }

    private _blockchainInfoRepository: BlockchainInformationRepository | undefined;

    protected get blockchainInfoRepository(): BlockchainInformationRepository {
        if (this._blockchainInfoRepository === undefined) {
            throw new Error('BlockchainInformationRepository not initialized');
        }

        return this._blockchainInfoRepository;
    }

    public async start(): Promise<void> {
        if (DBManagerInstance.db === null) {
            throw new Error('DBManager instance must be defined');
        }

        this._blockchainInfoRepository = new BlockchainInformationRepository(DBManagerInstance.db);

        await this.rpcClient.init(Config.BLOCKCHAIN);
        await this.vmManager.init();

        await this.safeProcessBlocks();
    }

    private async safeProcessBlocks(): Promise<void> {
        if (this.fatalFailure) {
            this.panic('Fatal failure detected, exiting...');
            return;
        }

        try {
            await this.processBlocks();
        } catch (e) {
            this.panic(`Error processing blocks: ${e}`);
        }

        if (this.processOnlyOneBlock) {
            return;
        }

        setTimeout(() => this.safeProcessBlocks(), 10000);
    }

    private async getCurrentProcessBlockHeight(startBlockHeight: number): Promise<number> {
        if (Config.OP_NET.REINDEX) {
            if (Config.OP_NET.REINDEX_FROM_BLOCK) {
                return Config.OP_NET.REINDEX_FROM_BLOCK;
            }

            return Config.OP_NET.ENABLED_AT_BLOCK;
        }

        const blockchainInfo = await this.blockchainInfoRepository.getByNetwork(this.network);

        // Process block either from the forced start height
        // or from the last in progress block saved in the database
        return startBlockHeight !== -1 ? startBlockHeight : blockchainInfo.inProgressBlock;
    }

    private async processBlocks(startBlockHeight: number = -1): Promise<void> {
        let blockHeightInProgress = await this.getCurrentProcessBlockHeight(startBlockHeight);
        let chainCurrentBlockHeight = await this.getChainCurrentBlockHeight();

        while (blockHeightInProgress <= chainCurrentBlockHeight) {
            const block = await this.getBlock(blockHeightInProgress);
            if (!block) {
                throw new Error(`Error fetching block ${blockHeightInProgress}.`);
            }

            const processStartTime = Date.now();
            const processed: Block | null = await this.processBlock(block);
            if (processed === null) {
                this.fatalFailure = true;
                throw new Error(`Error processing block ${blockHeightInProgress}.`);
            }

            const processEndTime = Date.now();
            if (Config.DEBUG_LEVEL > DebugLevel.INFO) {
                this.success(
                    `Block ${blockHeightInProgress} processed successfully. Took ${processEndTime - processStartTime}ms. {Transactions: ${processed.header.nTx} | Time to execute transactions: ${processed.timeForTransactionExecution}ms | Time for state update: ${processed.timeForStateUpdate}ms | Time for block processing: ${processed.timeForBlockProcessing}ms}`,
                );
            }

            blockHeightInProgress++;

            if (this.processOnlyOneBlock) {
                break;
            }

            // We update the block we just processed
            await this.updateBlockchainInfo(blockHeightInProgress);
        }

        chainCurrentBlockHeight = await this.getChainCurrentBlockHeight();
        if (blockHeightInProgress > chainCurrentBlockHeight) {
            if (Config.OP_NET.REINDEX) {
                Config.OP_NET.REINDEX = false;
            }

            this.success(`Indexer synchronized. Network height at: ${chainCurrentBlockHeight}.`);
        } else if (!this.processOnlyOneBlock) {
            await this.processBlocks(blockHeightInProgress);
        }
    }

    private async updateBlockchainInfo(blockHeight: number): Promise<void> {
        await this.blockchainInfoRepository.updateCurrentBlockInProgress(this.network, blockHeight);
    }

    private async processBlock(blockData: BlockDataWithTransactionData): Promise<Block | null> {
        const block: Block = new Block(blockData, this.bitcoinNetwork);

        // Deserialize the block.
        block.deserialize();

        // Execute the block and save the changes.
        const success = await block.execute(this.vmManager);

        if (success) return block;
        else return null;
    }

    private async getBlock(blockHeight: number): Promise<BlockDataWithTransactionData | null> {
        const blockHash: string | null = await this.rpcClient.getBlockHash(blockHeight);

        if (blockHash == null) {
            throw new Error(`Error fetching block hash.`);
        }

        return await this.rpcClient.getBlockInfoWithTransactionData(blockHash);
    }

    private async getChainCurrentBlockHeight(): Promise<number> {
        const chainInfo: BlockchainInfo | null = await this.rpcClient.getChainInfo();

        if (chainInfo == null) {
            throw new Error(`Error fetching blockchain information.`);
        }

        return chainInfo.blocks;
    }
}
