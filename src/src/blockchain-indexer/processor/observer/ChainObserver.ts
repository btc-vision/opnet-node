import { ConfigurableDBManager, Logger } from '@btc-vision/bsi-common';
import { BlockchainInfoRepository } from '../../../db/repositories/BlockchainInfoRepository.js';
import { BitcoinRPC, BlockchainInfo, BlockHeaderInfo } from '@btc-vision/bitcoin-rpc';
import { DataConverter } from '@btc-vision/bsi-common';
import { ConsensusTracker } from '../consensus/ConsensusTracker.js';
import { VMStorage } from '../../../vm/storage/VMStorage.js';
import { BlockProcessedData } from '../../../threading/interfaces/thread-messages/messages/indexer/BlockProcessed.js';
import { BitcoinNetwork } from '../../../config/network/BitcoinNetwork.js';
import { SynchronisationStatus } from '../interfaces/SynchronisationStatus.js';
import { Db } from 'mongodb';
import { Config } from '../../../config/Config.js';
import { BlockRepository } from '../../../db/repositories/BlockRepository.js';
import { IBlockHeaderBlockDocument } from '../../../db/interfaces/IBlockHeaderBlockDocument.js';

export class ChainObserver extends Logger {
    public readonly logColor: string = '#5eff00';

    public readonly synchronisationStatus: SynchronisationStatus = {
        bestBlockHash: null,

        currentBlockHash: null,
        pendingBlockHeight: 0n,
        targetBlockHeight: 0n,
        bestTip: 0n,

        initialBlockDownload: false,
        isDownloading: false,
        isReorging: false,
        isSyncing: false,

        chain: null,
    };

    constructor(
        private readonly network: BitcoinNetwork,
        private readonly database: ConfigurableDBManager,
        private readonly rpcClient: BitcoinRPC,
        private readonly consensusTracker: ConsensusTracker,
        private readonly vmStorage: VMStorage,
    ) {
        super();
    }

    public get pendingTaskHeight(): bigint {
        return this.synchronisationStatus.bestTip;
    }

    public get nextBestTip(): bigint {
        if (this.synchronisationStatus.bestTip > this.targetBlockHeight) {
            throw new Error('Next best tip is greater than target block height.');
        }

        return this.synchronisationStatus.bestTip++;
    }

    public set nextBestTip(block: bigint) {
        this.synchronisationStatus.bestTip = block;
    }

    public get chain(): string {
        if (!this.synchronisationStatus.chain) {
            throw new Error('Chain not set.');
        }

        return this.synchronisationStatus.chain;
    }

    public get targetBlockHeight(): bigint {
        return this.synchronisationStatus.targetBlockHeight;
    }

    public set targetBlockHeight(block: bigint) {
        this.synchronisationStatus.targetBlockHeight = block;
    }

    public get pendingBlockHeight(): bigint {
        return this.synchronisationStatus.pendingBlockHeight;
    }

    public set pendingBlockHeight(block: bigint) {
        this.synchronisationStatus.pendingBlockHeight = block;
    }

    private _blockchainRepository: BlockchainInfoRepository | undefined;

    private get blockchainRepository(): BlockchainInfoRepository {
        if (!this._blockchainRepository) {
            throw new Error('ChainInfo not initialized.');
        }

        return this._blockchainRepository;
    }

    private _blocks: BlockRepository | undefined;

    private get blocks(): BlockRepository {
        if (!this._blocks) {
            throw new Error('BlockRepository not initialized.');
        }

        return this._blocks;
    }

    private get db(): Db {
        if (!this.database.db) {
            throw new Error('Database not set.');
        }

        return this.database.db;
    }

    public async getBlockHeader(tip: bigint): Promise<IBlockHeaderBlockDocument | undefined> {
        return await this.blocks.getBlockHeader(tip);
    }

    public async init(): Promise<void> {
        this._blockchainRepository = new BlockchainInfoRepository(this.db);
        this._blocks = new BlockRepository(this.db);

        await this.sync();

        // Set initial consensus from database.
        if (this.consensusTracker.setConsensusBlockHeight(this.pendingTaskHeight)) {
            throw new Error('Consensus block height not set.');
        }
    }

    public notifyBlockProcessed: (block: BlockProcessedData) => Promise<void> = () => {
        throw new Error('notifyBlockProcessed not implemented.');
    };

    public async onChainReorganisation(
        fromHeight: bigint,
        toHeight: bigint,
        newBest: string,
    ): Promise<void> {
        this.synchronisationStatus.isReorging = true;

        this.debugBright(
            `Chain reorganisation detected: ${fromHeight} -> ${toHeight} - (${this.synchronisationStatus.bestBlockHash} -> ${newBest})`,
        );

        if (fromHeight === 0n) throw new Error('Invalid from height.');

        this.synchronisationStatus.bestBlockHash = newBest;

        const [blockHeight] = await Promise.safeAll([
            this.fetchChainHeight(),
            this.setNewHeight(fromHeight),
        ]);

        if (this.consensusTracker.setConsensusBlockHeight(fromHeight)) {
            throw new Error('Consensus block height not set.');
        }

        this.targetBlockHeight = blockHeight;
        this.nextBestTip = fromHeight;

        this.updateStatus();
    }

    public onBlockChange(blockInfo: BlockHeaderInfo): void {
        const height = BigInt(blockInfo.height);
        const hash = blockInfo.hash;

        this.targetBlockHeight = height;
        this.synchronisationStatus.bestBlockHash = hash;

        this.updateStatus();

        this.log(`Block change detected: ${height} - ${hash}`);
    }

    public watchBlockchain(): void {
        this.info(`Read only mode enabled.`);

        // TODO: Verify this.
        this.blockchainRepository.watchBlockChanges(async (blockHeight: bigint) => {
            this.info(`(from db) Block change detected: ${blockHeight}`);

            if (this.consensusTracker.setConsensusBlockHeight(blockHeight)) {
                throw new Error('Consensus block height not set.');
            }

            const currentBlock = await this.vmStorage.getBlockHeader(blockHeight);
            if (!currentBlock) {
                return this.warn(`Can not find block: ${currentBlock}.`);
            }

            await this.notifyBlockProcessed({
                ...currentBlock,
                blockHash: currentBlock.hash,
                blockNumber: DataConverter.fromDecimal128(currentBlock.height),
                checksumHash: currentBlock.checksumRoot,
                checksumProofs: currentBlock.checksumProofs.map((proof) => {
                    return {
                        proof: proof[1],
                    };
                }),
            });
        });
    }

    public async setNewHeight(height: bigint): Promise<void> {
        this.pendingBlockHeight = height;

        await this.updateCurrentBlockProgress();
    }

    private async updateCurrentBlockProgress(): Promise<void> {
        await this.blockchainRepository.updateCurrentBlockInProgress(
            this.network,
            Number(this.pendingBlockHeight + 1n),
        );
    }

    private async fetchChainHeight(): Promise<bigint> {
        const chainHeight = await this.rpcClient.getBlockCount();
        if (chainHeight == null) {
            throw new Error('Chain height not found.');
        }

        return BigInt(chainHeight);
    }

    private async fetchChainInfo(): Promise<BlockchainInfo> {
        const chainInfo = await this.rpcClient.getChainInfo();
        if (!chainInfo) {
            throw new Error('Chain info not found.');
        }

        return chainInfo;
    }

    private async fetchBlockHash(height: bigint): Promise<string> {
        const blockHash = await this.rpcClient.getBlockHash(Number(height));
        if (!blockHash) {
            throw new Error('Block hash not found.');
        }

        return blockHash;
    }

    private async fetchCurrentHeightFromDB(): Promise<bigint> {
        const currentBlockHeight = await this.blockchainRepository.getByNetwork(this.network);
        if (currentBlockHeight === null) {
            throw new Error('Current block height not found in database.');
        }

        const block = BigInt(currentBlockHeight.inProgressBlock);

        if (block <= 0n) {
            return block;
        }

        return block - 1n;
    }

    private updateStatus(): void {
        this.synchronisationStatus.isDownloading = this.pendingBlockHeight < this.targetBlockHeight;
        this.synchronisationStatus.isSyncing = this.pendingBlockHeight !== this.targetBlockHeight;
    }

    private async sync(): Promise<void> {
        const [opnetHeight, chainHeight, chainInfo] = await Promise.safeAll([
            this.fetchCurrentHeightFromDB(),
            this.fetchChainHeight(),
            this.fetchChainInfo(),
        ]);

        const pendingBlockHeight = Config.OP_NET.REINDEX
            ? BigInt(Config.OP_NET.REINDEX_FROM_BLOCK) || 0n
            : opnetHeight;

        this.pendingBlockHeight = pendingBlockHeight;
        this.nextBestTip = pendingBlockHeight;
        this.targetBlockHeight = chainHeight;

        this.synchronisationStatus.bestBlockHash = chainInfo.bestblockhash;
        this.synchronisationStatus.chain = chainInfo.chain;
        this.synchronisationStatus.initialBlockDownload = chainInfo.initialblockdownload;

        this.updateStatus();

        if (this.synchronisationStatus.initialBlockDownload) {
            const blockLeft = chainInfo.headers - chainInfo.blocks;

            this.warn(
                `Chain is still downloading blocks. ${blockLeft} blocks left. (${chainInfo.blocks}/${chainInfo.headers})`,
            );
        }
    }
}
