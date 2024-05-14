import {
    BitcoinRPC,
    BlockchainInfo,
    BlockDataWithTransactionData,
} from '@btc-vision/bsi-bitcoin-rpc';
import { DebugLevel, Logger } from '@btc-vision/bsi-common';
import bitcoin from 'bitcoinjs-lib';
import { BtcIndexerConfig } from '../../config/BtcIndexerConfig.js';
import { Config } from '../../config/Config.js';
import { DBManagerInstance } from '../../db/DBManager.js';
import { BlockchainInformationRepository } from '../../db/repositories/BlockchainInformationRepository.js';
import { MessageType } from '../../threading/enum/MessageType.js';
import {
    BlockProcessedData,
    BlockProcessedMessage,
} from '../../threading/interfaces/thread-messages/messages/indexer/BlockProcessed.js';
import { CurrentIndexerBlockResponseData } from '../../threading/interfaces/thread-messages/messages/indexer/CurrentIndexerBlock.js';
import { StartIndexerResponseData } from '../../threading/interfaces/thread-messages/messages/indexer/StartIndexer.js';
import { ThreadMessageBase } from '../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../../threading/interfaces/ThreadData.js';
import { ThreadTypes } from '../../threading/thread/enums/ThreadTypes.js';
import { VMManager } from '../../vm/VMManager.js';
import { Block } from './block/Block.js';

export class BlockchainIndexer extends Logger {
    public readonly logColor: string = '#00ff00';

    private readonly network: string;
    private readonly rpcClient: BitcoinRPC = new BitcoinRPC();

    private readonly bitcoinNetwork: bitcoin.networks.Network;

    private readonly vmManager: VMManager;
    private readonly processOnlyOneBlock: boolean = false;

    private readonly maximumPrefetchBlocks: number;
    private readonly prefetchedBlocks: Map<number, Promise<BlockDataWithTransactionData | null>> =
        new Map();

    private fatalFailure: boolean = false;
    private currentBlockInProcess: Promise<void> | undefined;

    constructor(config: BtcIndexerConfig) {
        super();

        this.maximumPrefetchBlocks = config.OP_NET.MAXIMUM_PREFETCH_BLOCKS;
        this.network = config.BLOCKCHAIN.BITCOIND_NETWORK;

        this.vmManager = new VMManager(config);

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

    public async handleBitcoinIndexerMessage(
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData> {
        let resp: ThreadData;
        switch (m.type) {
            case MessageType.CURRENT_INDEXER_BLOCK: {
                resp = await this.getCurrentBlock();
                break;
            }
            case MessageType.START_INDEXER: {
                resp = await this.startIndexer();
                break;
            }
            default:
                throw new Error(`Unknown message type: ${m.type} received in PoA.`);
        }

        return resp ?? null;
    }

    public sendMessageToThread: (
        type: ThreadTypes,
        message: ThreadMessageBase<MessageType>,
    ) => Promise<ThreadData | null> = async () => {
        throw new Error('sendMessageToThread not implemented.');
    };

    public async init(): Promise<void> {
        if (DBManagerInstance.db === null) {
            throw new Error('DBManager instance must be defined');
        }

        this._blockchainInfoRepository = new BlockchainInformationRepository(DBManagerInstance.db);

        await this.rpcClient.init(Config.BLOCKCHAIN);
        await this.vmManager.init();
    }

    private async getCurrentBlock(): Promise<CurrentIndexerBlockResponseData> {
        const blockchainInfo = await this.getCurrentProcessBlockHeight(-1);

        return {
            blockNumber: BigInt(blockchainInfo - 1),
        };
    }

    /*private listenEvents(): void {
        let called = false;
        process.on('SIGINT', async () => {
            if (!called) {
                called = true;
                await this.terminateAllActions();
            }
        });

        process.on('SIGQUIT', async () => {
            if (!called) {
                called = true;
                await this.terminateAllActions();
            }
        });

        process.on('SIGTERM', async () => {
            if (!called) {
                called = true;
                await this.terminateAllActions();
            }
        });
    }

    private async terminateAllActions(): Promise<void> {
        this.info('Terminating all actions...');
        this.fatalFailure = true;

        await this.currentBlockInProcess;
        await this.vmManager.terminate();

        process.exit(0);
    }*/

    private async safeProcessBlocks(): Promise<void> {
        if (this.fatalFailure) {
            this.panic('Fatal failure detected, exiting...');
            return;
        }

        try {
            this.currentBlockInProcess = this.processBlocks();

            await this.currentBlockInProcess;
        } catch (e) {
            const error = e as Error;
            this.panic(`Error processing blocks: ${error.stack}`);
        }

        if (this.processOnlyOneBlock) {
            return;
        }

        setTimeout(() => this.safeProcessBlocks(), 5000);
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

    private prefetchBlocks(blockHeightInProgress: number, chainCurrentBlockHeight: number): void {
        for (let i = 1; i <= this.maximumPrefetchBlocks; i++) {
            const nextBlockId = blockHeightInProgress + i;

            if (nextBlockId > chainCurrentBlockHeight) {
                break;
            }

            const currentPrefetchBlockSize = this.prefetchedBlocks.size;
            if (currentPrefetchBlockSize > this.maximumPrefetchBlocks) {
                break;
            }

            if (this.prefetchedBlocks.has(nextBlockId)) {
                continue;
            }

            if (Config.DEBUG_LEVEL > DebugLevel.TRACE) {
                this.debug(`!!!!!!!!! ------ Prefetching block ${nextBlockId} ------ !!!!!!!!!`);
            }

            this.prefetchedBlocks.set(nextBlockId, this.getBlock(nextBlockId));
        }
    }

    private async getBlockFromPrefetch(
        blockHeight: number,
        chainCurrentBlockHeight: number,
    ): Promise<BlockDataWithTransactionData | null> {
        this.prefetchBlocks(blockHeight, chainCurrentBlockHeight);

        const block: Promise<BlockDataWithTransactionData | null> =
            this.prefetchedBlocks.get(blockHeight) || this.getBlock(blockHeight);

        this.prefetchedBlocks.delete(blockHeight);

        return block;
    }

    private async processBlocks(startBlockHeight: number = -1): Promise<void> {
        let blockHeightInProgress = await this.getCurrentProcessBlockHeight(startBlockHeight);
        let chainCurrentBlockHeight = await this.getChainCurrentBlockHeight();

        while (blockHeightInProgress <= chainCurrentBlockHeight) {
            const getBlockDataTimingStart = Date.now();
            const block = await this.getBlockFromPrefetch(
                blockHeightInProgress,
                chainCurrentBlockHeight,
            );

            if (!block) {
                throw new Error(`Error fetching block ${blockHeightInProgress}.`);
            }

            if (block.height !== blockHeightInProgress) {
                throw new Error(
                    `Block height mismatch. Expected: ${blockHeightInProgress}, got: ${block.height}`,
                );
            }

            const processStartTime = Date.now();
            const processed: Block | null = await this.processBlock(block, this.vmManager);
            if (processed === null) {
                this.fatalFailure = true;
                throw new Error(`Error processing block ${blockHeightInProgress}.`);
            }

            const processEndTime = Date.now();
            if (Config.DEBUG_LEVEL >= DebugLevel.WARN) {
                this.info(
                    `Block ${blockHeightInProgress} processed successfully. {Transaction(s): ${processed.header.nTx} | Fetch Data: ${processStartTime - getBlockDataTimingStart}ms | Execute transactions: ${processed.timeForTransactionExecution}ms | State update: ${processed.timeForStateUpdate}ms | Block processing: ${processed.timeForBlockProcessing}ms | Generic transaction saving: ${processed.timeForGenericTransactions}ms | Took ${processEndTime - processStartTime}ms})`,
                );
            }

            await this.notifyBlockProcessed(processed);

            blockHeightInProgress++;

            if (this.processOnlyOneBlock) {
                break;
            }
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

    private async processBlock(
        blockData: BlockDataWithTransactionData,
        chosenManager: VMManager,
    ): Promise<Block | null> {
        const block: Block = new Block(blockData, this.bitcoinNetwork);

        // Deserialize the block.
        block.deserialize();

        // Execute the block and save the changes.
        const success = await block.execute(chosenManager);
        if (!success) {
            return null;
        }

        // We must write the block to the database before returning it.
        const finalized = await block.finalizeBlock(chosenManager);

        if (finalized) {
            return block;
        } else {
            return null;
        }
    }

    private async getBlock(blockHeight: number): Promise<BlockDataWithTransactionData | null> {
        const blockHash: string | null = await this.rpcClient.getBlockHash(blockHeight);

        if (blockHash == null) {
            throw new Error(`Error fetching block hash.`);
        }

        return await this.rpcClient.getBlockInfoWithTransactionData(blockHash);
    }

    private async notifyBlockProcessed(block: Block): Promise<void> {
        const blockHeader: BlockProcessedData = {
            blockNumber: block.height,
            blockHash: block.hash,
            previousBlockHash: block.previousBlockHash,

            merkleRoot: block.merkleRoot,
            receiptRoot: block.receiptRoot,
            storageRoot: block.storageRoot,

            checksumHash: block.checksumRoot,
            checksumProofs: block.checksumProofs.map((proof) => {
                return {
                    proof: proof[1],
                };
            }),
            previousBlockChecksum: block.previousBlockChecksum,

            txCount: block.header.nTx,
        };

        const msg: BlockProcessedMessage = {
            type: MessageType.BLOCK_PROCESSED,
            data: blockHeader,
        };

        await this.sendMessageToThread(ThreadTypes.PoA, msg);
    }

    private async startIndexer(): Promise<StartIndexerResponseData> {
        console.log('BOOT.');

        if (this.currentBlockInProcess) {
            return {
                started: false,
            };
        }

        await this.safeProcessBlocks();

        return {
            started: true,
        };
    }

    private async getChainCurrentBlockHeight(): Promise<number> {
        const chainInfo: BlockchainInfo | null = await this.rpcClient.getChainInfo();

        if (chainInfo == null) {
            throw new Error(`Error fetching blockchain information.`);
        }

        return chainInfo.blocks;
    }
}
