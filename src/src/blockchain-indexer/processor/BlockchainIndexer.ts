import {
    BitcoinRPC,
    BlockchainInfo,
    BlockDataWithTransactionData,
} from '@btc-vision/bsi-bitcoin-rpc';
import { BitcoinNetwork, DebugLevel, Logger } from '@btc-vision/bsi-common';
import bitcoin from 'bitcoinjs-lib';
import { BtcIndexerConfig } from '../../config/BtcIndexerConfig.js';
import { Config } from '../../config/Config.js';
import { DBManagerInstance } from '../../db/DBManager.js';
import { BlockHeaderBlockDocument } from '../../db/interfaces/IBlockHeaderBlockDocument.js';
import { IReorgData } from '../../db/interfaces/IReorgDocument.js';
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
import { VMStorage } from '../../vm/storage/VMStorage.js';
import { VMManager } from '../../vm/VMManager.js';
import { Block } from './block/Block.js';
import { SpecialManager } from './special-transaction/SpecialManager.js';
import { NetworkConverter } from '../../config/NetworkConverter.js';

interface LastBlock {
    hash?: string;
    checksum?: string;
}

export class BlockchainIndexer extends Logger {
    public readonly logColor: string = '#00ff00';

    private readonly network: BitcoinNetwork;
    private readonly rpcClient: BitcoinRPC = new BitcoinRPC();

    private readonly bitcoinNetwork: bitcoin.networks.Network;

    private readonly vmManager: VMManager;
    private readonly vmStorage: VMStorage;
    private readonly specialTransactionManager: SpecialManager;

    private readonly processOnlyOneBlock: boolean = false;

    private readonly maximumPrefetchBlocks: number;
    private readonly prefetchedBlocks: Map<number, Promise<BlockDataWithTransactionData | null>> =
        new Map();

    private fatalFailure: boolean = false;
    private currentBlockInProcess: Promise<void> | undefined;

    private lastBlock: LastBlock = {};

    private pendingNextBlockScan: NodeJS.Timeout | undefined;

    constructor(config: BtcIndexerConfig) {
        super();

        this.maximumPrefetchBlocks = config.OP_NET.MAXIMUM_PREFETCH_BLOCKS;
        this.network = config.BLOCKCHAIN.BITCOIND_NETWORK;

        this.vmManager = new VMManager(config);
        this.vmStorage = this.vmManager.getVMStorage();

        this.specialTransactionManager = new SpecialManager(this.vmManager);
        this.bitcoinNetwork = NetworkConverter.getNetwork(this.network);
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

        if (Config.P2P.IS_BOOTSTRAP_NODE) {
            setTimeout(() => this.startAndPurgeIndexer(), 8000);
        }
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

    private async safeProcessBlocks(startBlockHeight: number): Promise<void> {
        if (this.fatalFailure) {
            this.panic('Fatal failure detected, exiting...');
            return;
        }

        try {
            this.currentBlockInProcess = this.processBlocks(startBlockHeight);

            await this.currentBlockInProcess;
        } catch (e) {
            const error = e as Error;
            this.panic(`Error processing blocks: ${error.stack}`);
        }

        if (this.processOnlyOneBlock) {
            return;
        }

        this.pendingNextBlockScan = setTimeout(() => this.safeProcessBlocks(-1), 5000);
    }

    private async getCurrentProcessBlockHeight(startBlockHeight: number): Promise<number> {
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

    private async getLastBlockHash(height: bigint): Promise<LastBlock | undefined> {
        if (height === -1n || this.processOnlyOneBlock) {
            return;
        } else if (this.lastBlock.hash && this.lastBlock.checksum) {
            return {
                hash: this.lastBlock.hash,
                checksum: this.lastBlock.checksum,
            };
        }

        const previousBlock = await this.vmManager.getBlockHeader(height);
        if (!previousBlock) {
            throw new Error(
                `Error fetching previous block hash. Can not verify chain reorg. Block height: ${height}`,
            );
        }

        return {
            hash: previousBlock.hash,
            checksum: previousBlock.checksumRoot,
        };
    }

    private async verifyChainReorg(
        block: BlockDataWithTransactionData,
        opnetChecksum?: string,
    ): Promise<boolean> {
        const previousBlock = BigInt(block.height) - 1n;
        if (previousBlock <= 0n) {
            return false; // Genesis block reached.
        }

        const [previousBlockHash, previousOpnetBlock] = await Promise.all([
            this.getLastBlockHash(previousBlock),
            this.vmStorage.getBlockHeader(previousBlock),
        ]);

        if (!previousBlockHash) return false;

        // Verify if the previous block hash is the same as the current block's previous block hash.
        const bitcoinReorged = block.previousblockhash !== previousBlockHash.hash;
        if (!previousOpnetBlock || !bitcoinReorged) return bitcoinReorged;

        // Verify opnet checksum proofs.
        try {
            const verifiedProofs: boolean =
                await this.vmManager.validateBlockChecksum(previousOpnetBlock);

            if (opnetChecksum) {
                const opnetBadChecksum = previousOpnetBlock.checksumRoot !== opnetChecksum;

                return opnetBadChecksum || !verifiedProofs;
            }

            return !verifiedProofs;
        } catch (e) {
            this.panic(`Error validating block checksum: ${e}`);
            return true;
        }
    }

    /**
     * We must find the last known good block to revert to.
     */
    private async revertToLastGoodBlock(height: number): Promise<bigint> {
        let shouldContinue: boolean = true;
        let previousBlock: number = height;

        do {
            previousBlock--;

            if (previousBlock < 0) {
                this.error(`Can not revert to a block lower than 0. GENESIS block reached.`);

                return 0n;
            }

            const promises: [
                Promise<string | null>,
                Promise<BlockHeaderBlockDocument | undefined>,
            ] = [
                this.rpcClient.getBlockHash(previousBlock),
                this.vmStorage.getBlockHeader(BigInt(previousBlock)),
            ];

            const results = await Promise.all(promises);

            const currentBlockHash: string | null = results[0];
            if (currentBlockHash === null) {
                throw new Error(`Error fetching block hash.`);
            }

            const savedBlockHeader: BlockHeaderBlockDocument | undefined = results[1];
            if (!savedBlockHeader) {
                throw new Error(`Error fetching block header.`);
            }

            if (savedBlockHeader.hash === currentBlockHash) {
                shouldContinue = false;
                this.success(`Validated headers for block ${previousBlock}... (GOOD)`);
            } else {
                this.fail(`Validated headers for block ${previousBlock}... (BAD)`);
            }
        } while (shouldContinue);

        do {
            const opnetHeaders = await this.vmStorage.getBlockHeader(BigInt(previousBlock));

            if (!opnetHeaders) {
                this.warn(`No OPNet headers found for block ${previousBlock}.`);
                break;
            }

            try {
                const verifiedProofs: boolean =
                    await this.vmManager.validateBlockChecksum(opnetHeaders);

                if (verifiedProofs) {
                    this.success(`Validated checksum proofs for block ${previousBlock}... (GOOD)`);
                    break;
                } else {
                    this.fail(`Validated checksum proofs for block ${previousBlock}... (BAD)`);
                }
            } catch (e) {
                this.fail(`Validated checksum proofs for block ${previousBlock}... (BAD)`);
            }
        } while (previousBlock-- > 0);

        return BigInt(previousBlock);
    }

    private async revertDataUntilBlock(height: bigint): Promise<void> {
        this.important(`STOPPED ALL JOBS. Purging bad data until block ${height}.`);

        await this.vmStorage.revertDataUntilBlock(height);
    }

    /** Handle blockchain restoration here. */
    private async restoreBlockchain(height: number): Promise<void> {
        if (height === 0) throw new Error(`Can not restore blockchain from genesis block.`);

        this.important(
            `!!!! ----- Chain reorganization detected. Block ${height} has a different previous block hash. ----- !!!!`,
        );

        await this.purge();

        // We must identify the last known good block.
        const lastGoodBlock: bigint = await this.revertToLastGoodBlock(height);
        this.info(`OPNet will automatically revert to block ${lastGoodBlock}.`);

        const reorgData: IReorgData = {
            fromBlock: BigInt(height),
            toBlock: lastGoodBlock,
            timestamp: new Date(),
        };

        await this.vmStorage.setReorg(reorgData);

        // We must purge all the bad data.
        await this.revertDataUntilBlock(lastGoodBlock);

        this.vmStorage.resumeWrites();

        // We must reprocess the blocks from the last known good block.
        const blockToRescan: number = Math.max(Number(lastGoodBlock) - 1, -1);
        await this.processBlocks(blockToRescan, true);
    }

    private async purge(): Promise<void> {
        clearTimeout(this.pendingNextBlockScan);

        this.lastBlock.hash = undefined;
        this.prefetchedBlocks.clear();

        await this.vmStorage.awaitPendingWrites();
        await this.vmManager.clear();
    }

    private async processBlocks(
        startBlockHeight: number = -1,
        wasReorg: boolean = false,
    ): Promise<void> {
        let blockHeightInProgress: number = wasReorg
            ? startBlockHeight
            : await this.getCurrentProcessBlockHeight(startBlockHeight);

        let chainCurrentBlockHeight: number = await this.getChainCurrentBlockHeight();

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

            /** We must check for chain reorgs here. */
            const chainReorged: boolean = await this.verifyChainReorg(block);
            if (chainReorged) {
                await this.restoreBlockchain(blockHeightInProgress);
                return;
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

            this.lastBlock.hash = processed.hash;
            this.lastBlock.checksum = processed.checksumRoot;

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

            const blockHash: string | null = await this.rpcClient.getBlockHash(
                blockHeightInProgress - 1,
            );
            if (blockHash == null) {
                throw new Error(`Error fetching block hash.`);
            }

            if (this.lastBlock && this.lastBlock.hash && this.lastBlock.hash !== blockHash) {
                this.panic(
                    `Last block hash mismatch. Expected: ${this.lastBlock.hash}, got: ${blockHash}.`,
                );

                return await this.restoreBlockchain(blockHeightInProgress);
            }

            this.success(`Indexer synchronized. Network height at: ${chainCurrentBlockHeight}.`);
        } else if (!this.processOnlyOneBlock) {
            await this.processBlocks(blockHeightInProgress);
        }
    }

    private async processBlock(
        blockData: BlockDataWithTransactionData,
        chosenManager: VMManager,
        chosenSpecialManager: SpecialManager = this.specialTransactionManager,
    ): Promise<Block | null> {
        const block: Block = new Block(blockData, this.bitcoinNetwork);

        // Deserialize the block.
        block.deserialize();

        // Execute the block and save the changes.
        const success = await block.execute(chosenManager, chosenSpecialManager);
        if (!success) {
            return null;
        }

        chosenSpecialManager.reset();

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

    private getDefaultBlockHeight(): number {
        let startBlockHeight = -1;
        if (Config.OP_NET.REINDEX) {
            if (Config.OP_NET.REINDEX_FROM_BLOCK) {
                startBlockHeight = Config.OP_NET.REINDEX_FROM_BLOCK;
            } else {
                startBlockHeight = Config.OP_NET.ENABLED_AT_BLOCK;
            }
        }

        return startBlockHeight;
    }

    private async startIndexer(): Promise<StartIndexerResponseData> {
        if (Config.P2P.IS_BOOTSTRAP_NODE) {
            return {
                started: true,
            };
        }

        if (this.currentBlockInProcess) {
            return {
                started: false,
            };
        }

        await this.startAndPurgeIndexer();

        return {
            started: true,
        };
    }

    private async startAndPurgeIndexer(): Promise<void> {
        const startBlock = this.getDefaultBlockHeight();
        if (startBlock !== -1) {
            // Purge old data
            this.log(`Purging old data... (from block ${startBlock})`);

            await this.vmStorage.revertDataUntilBlock(BigInt(startBlock));
        }

        void this.safeProcessBlocks(startBlock);
    }

    private async getChainCurrentBlockHeight(): Promise<number> {
        const chainInfo: BlockchainInfo | null = await this.rpcClient.getChainInfo();

        if (chainInfo == null) {
            throw new Error(`Error fetching blockchain information.`);
        }

        return chainInfo.blocks;
    }
}
