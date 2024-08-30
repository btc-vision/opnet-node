import { ConfigurableDBManager, Logger } from '@btc-vision/bsi-common';
import { BlockchainInfoRepository } from '../../../db/repositories/BlockchainInfoRepository.js';
import { BitcoinRPC, BlockchainInfo, BlockHeaderInfo } from '@btc-vision/bsi-bitcoin-rpc';
import { DataConverter } from '@btc-vision/bsi-db';
import { ConsensusTracker } from '../consensus/ConsensusTracker.js';
import { VMStorage } from '../../../vm/storage/VMStorage.js';
import { BlockProcessedData } from '../../../threading/interfaces/thread-messages/messages/indexer/BlockProcessed.js';
import { BitcoinNetwork } from '../../../config/network/BitcoinNetwork.js';
import { SynchronisationStatus } from '../interfaces/SynchronisationStatus.js';
import { Db } from 'mongodb';
import { Config } from '../../../config/Config.js';

export class ChainObserver extends Logger {
    public readonly logColor: string = '#5eff00';

    private readonly synchronisationStatus: SynchronisationStatus = {
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

    private get db(): Db {
        if (!this.database.db) {
            throw new Error('Database not set.');
        }

        return this.database.db;
    }

    public async init(): Promise<void> {
        this._blockchainRepository = new BlockchainInfoRepository(this.db);

        await this.sync();

        // Set initial consensus from database.
        this.consensusTracker.setConsensusBlockHeight(this.pendingBlockHeight);
    }

    public notifyBlockProcessed: (block: BlockProcessedData) => Promise<void> = async () => {
        throw new Error('notifyBlockProcessed not implemented.');
    };

    public async onChainReorganisation(
        fromHeight: bigint,
        toHeight: bigint,
        newBest: string,
    ): Promise<void> {
        this.synchronisationStatus.isReorging = true;

        this.info(
            `Chain reorganisation detected: ${fromHeight} -> ${toHeight} - (${this.synchronisationStatus.bestBlockHash} -> ${newBest})`,
        );

        this.synchronisationStatus.bestBlockHash = newBest;
        this.pendingBlockHeight = fromHeight;
        this.targetBlockHeight = toHeight;
        this.nextBestTip = fromHeight;

        this.updateStatus();

        await this.blockchainRepository.updateCurrentBlockInProgress(
            this.network,
            Number(this.pendingBlockHeight + 1n),
        );
    }

    public async onBlockChange(blockInfo: BlockHeaderInfo): Promise<void> {
        const height = BigInt(blockInfo.height);
        const hash = blockInfo.hash;

        this.targetBlockHeight = height;
        this.synchronisationStatus.bestBlockHash = hash;

        this.updateStatus();

        this.info(`Block change detected: ${height} - ${hash}`);
    }

    public async watchBlockchain(): Promise<void> {
        this.info(`Read only mode enabled.`);

        // TODO: Verify this.
        this.blockchainRepository.watchBlockChanges(async (blockHeight: bigint) => {
            this.consensusTracker.setConsensusBlockHeight(blockHeight);

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

        return BigInt(currentBlockHeight.inProgressBlock);
    }

    private updateStatus(): void {
        this.synchronisationStatus.isDownloading = this.pendingBlockHeight < this.targetBlockHeight;
        this.synchronisationStatus.isSyncing = this.pendingBlockHeight !== this.targetBlockHeight;
    }

    private async sync(): Promise<void> {
        const [opnetHeight, chainHeight, chainInfo] = await Promise.all([
            this.fetchCurrentHeightFromDB(),
            this.fetchChainHeight(),
            this.fetchChainInfo(),
        ]);

        this.pendingBlockHeight = opnetHeight;
        this.nextBestTip = Config.OP_NET.REINDEX
            ? BigInt(Config.OP_NET.REINDEX_FROM_BLOCK) || 0n
            : opnetHeight;
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
