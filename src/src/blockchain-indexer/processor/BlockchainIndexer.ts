import {
    BitcoinRPC,
    BlockchainInfo,
    BlockDataWithTransactionData,
} from '@btc-vision/bsi-bitcoin-rpc';
import { Logger } from '@btc-vision/bsi-common';
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
        try {
            await this.processBlocks();
        } catch (e) {
            this.error(e);

            await this.vmManager.revertBlock();
        }

        setTimeout(() => this.safeProcessBlocks(), 10000);
    }

    private async processBlocks(startBlockHeight: number = -1): Promise<void> {
        const blockchainInfo = await this.blockchainInfoRepository.getByNetwork(this.network);

        // Process block either from the forced start height
        // or from the last in progress block saved in the database
        let blockHeightInProgress =
            startBlockHeight !== -1 ? startBlockHeight : blockchainInfo.inProgressBlock;

        let chainCurrentBlockHeight = await this.getChainCurrentBlockHeight();

        while (blockHeightInProgress <= chainCurrentBlockHeight) {
            const block = await this.getBlock(blockHeightInProgress);
            if (!block) {
                throw new Error(`Error fetching block ${blockHeightInProgress}.`);
            }

            await this.processBlock(block);

            chainCurrentBlockHeight = await this.getChainCurrentBlockHeight();
            blockHeightInProgress++;
        }
    }

    private async processBlock(blockData: BlockDataWithTransactionData): Promise<void> {
        await this.vmManager.prepareBlock(BigInt(blockData.height));

        // Deserialize the block.
        const block: Block = new Block(blockData, this.bitcoinNetwork);
        await block.process();

        // Execute the block.
        // ... not implemented yet.

        await this.vmManager.terminateBlock();
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
