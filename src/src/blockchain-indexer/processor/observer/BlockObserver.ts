import { ConfigurableDBManager, Logger } from '@btc-vision/bsi-common';
import { Block } from 'bitcoinjs-lib';
import { BlockchainInformationRepository } from '../../../db/repositories/BlockchainInformationRepository.js';
import { BitcoinRPC } from '@btc-vision/bsi-bitcoin-rpc';
import { DataConverter } from '@btc-vision/bsi-db';
import { ConsensusTracker } from '../consensus/ConsensusTracker.js';
import { VMStorage } from '../../../vm/storage/VMStorage.js';
import { BlockProcessedData } from '../../../threading/interfaces/thread-messages/messages/indexer/BlockProcessed.js';
import { BitcoinNetwork } from '../../../config/network/BitcoinNetwork.js';
import { SynchronisationStatus } from '../interfaces/SynchronisationStatus.js';
import { Db } from 'mongodb';

export class BlockObserver extends Logger {
    public readonly logColor: string = '#5eff00';

    private readonly synchronisationStatus: SynchronisationStatus = {
        bestBlockHash: null,
        currentBlockHeight: 0n,
        isDownloading: false,
        isReorging: false,
        isSyncing: false,
        targetBlockHeight: 0n,
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

    public get currentBlockHeight(): bigint {
        return this.synchronisationStatus.currentBlockHeight;
    }

    public set currentBlockHeight(block: bigint) {
        this.synchronisationStatus.currentBlockHeight = block;
    }

    private _previousBlock: Block | undefined;

    public get previousBlock(): Block | undefined {
        return this._previousBlock;
    }

    public set previousBlock(block: Block | undefined) {
        this._previousBlock = block;
    }

    private _blockchainInfo: BlockchainInformationRepository | undefined;

    private get blockchainInfo(): BlockchainInformationRepository {
        if (!this._blockchainInfo) {
            throw new Error('BlockchainInformationRepository not set.');
        }

        return this._blockchainInfo;
    }

    private get db(): Db {
        if (!this.database.db) {
            throw new Error('Database not set.');
        }

        return this.database.db;
    }

    public async init(): Promise<void> {
        this._blockchainInfo = new BlockchainInformationRepository(this.db);
    }

    public notifyBlockProcessed: (block: BlockProcessedData) => Promise<void> = async () => {
        throw new Error('notifyBlockProcessed not implemented.');
    };

    public async watchBlockchain(): Promise<void> {
        this.info(`Read only mode enabled.`);

        // TODO: Verify this.
        this.blockchainInfo.watchBlockChanges(async (blockHeight: bigint) => {
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

    public async fetchCurrentHeightFromDB(): Promise<void> {
        const currentBlockHeight = await this.blockchainInfo.getByNetwork(this.network);
        if (currentBlockHeight === null) {
            throw new Error('Current block height not found in database.');
        }

        this.currentBlockHeight = BigInt(currentBlockHeight.inProgressBlock);
    }
}
