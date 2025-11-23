import { BaseRepository } from '@btc-vision/bsi-common';
import { Binary, ClientSession, Collection, Db, Filter } from 'mongodb';
import { IEpochDocument } from '../documents/interfaces/IEpochDocument.js';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';
import { DataConverter } from '@btc-vision/bsi-common';
import { SafeBigInt } from '../../api/routes/safe/BlockParamsConverter.js';
import { ChallengeSolution } from '../../blockchain-indexer/processor/interfaces/TransactionPreimage.js';
import { Address, AddressMap } from '@btc-vision/transaction';
import { OPNetConsensus } from '../../poa/configurations/OPNetConsensus.js';

export class EpochRepository extends BaseRepository<IEpochDocument> {
    public readonly logColor: string = '#ffd700';

    public constructor(db: Db) {
        super(db);
    }

    /**
     * Get the latest epoch
     */
    public async getLatestEpoch(
        currentSession?: ClientSession,
    ): Promise<IEpochDocument | undefined> {
        const criteria: Partial<Filter<IEpochDocument>> = {};
        const result: IEpochDocument | null = await this.queryOne(criteria, currentSession, {
            epochNumber: -1,
        });

        if (result === null) {
            return;
        }

        return result;
    }

    /**
     * Get epoch by epoch number
     */
    public async getEpochByNumber(
        epochNumber: SafeBigInt,
        currentSession?: ClientSession,
    ): Promise<IEpochDocument | undefined> {
        if (epochNumber === -1) {
            return this.getLatestEpoch(currentSession);
        }

        const criteria: Partial<Filter<IEpochDocument>> = {
            epochNumber: DataConverter.toDecimal128(epochNumber),
        };

        const result: IEpochDocument | null = await this.queryOne(criteria, currentSession);
        if (result === null) {
            return;
        }

        return result;
    }

    /**
     * Get epoch by epoch hash
     */
    public async getEpochByHash(
        epochHash: Buffer | Binary,
        currentSession?: ClientSession,
    ): Promise<IEpochDocument | undefined> {
        const binaryHash = epochHash instanceof Binary ? epochHash : new Binary(epochHash);

        const criteria: Partial<Filter<IEpochDocument>> = {
            epochHash: binaryHash,
        };

        const result: IEpochDocument | null = await this.queryOne(criteria, currentSession);
        if (result === null) {
            return;
        }

        return result;
    }

    /**
     * Get epoch by block height (find which epoch contains this block)
     */
    public async getEpochByBlockHeight(
        blockHeight: bigint,
        currentSession?: ClientSession,
    ): Promise<IEpochDocument | undefined> {
        const block = DataConverter.toDecimal128(blockHeight);
        const criteria: Partial<Filter<IEpochDocument>> = {
            startBlock: { $lte: block },
            endBlock: { $gte: block },
        };

        const result: IEpochDocument | null = await this.queryOne(criteria, currentSession);
        if (result === null) {
            return;
        }

        return result;
    }

    /**
     * Get active epoch (where endBlock is -1)
     */
    public async getActiveEpoch(
        currentSession?: ClientSession,
    ): Promise<IEpochDocument | undefined> {
        const criteria: Partial<Filter<IEpochDocument>> = {
            endBlock: DataConverter.toDecimal128(-1n),
        };

        const result: IEpochDocument | null = await this.queryOne(criteria, currentSession);
        if (result === null) {
            return;
        }

        return result;
    }

    /**
     * Get epochs by proposer public key
     */
    public async getEpochsByProposer(
        proposerPublicKey: Buffer | Binary,
        currentSession?: ClientSession,
    ): Promise<IEpochDocument[]> {
        const binaryKey =
            proposerPublicKey instanceof Binary ? proposerPublicKey : new Binary(proposerPublicKey);

        const criteria: Partial<Filter<IEpochDocument>> = {
            'proposer.publicKey': binaryKey,
        };

        return await this.queryMany(criteria, currentSession, {
            epochNumber: -1,
        });
    }

    /**
     * Get epochs within a block range
     */
    public async getEpochsInBlockRange(
        startBlock: bigint,
        endBlock: bigint,
        currentSession?: ClientSession,
    ): Promise<IEpochDocument[]> {
        const end = DataConverter.toDecimal128(endBlock);
        const start = DataConverter.toDecimal128(startBlock);

        const criteria: Partial<Filter<IEpochDocument>> = {
            $or: [
                {
                    startBlock: { $gte: start, $lte: end },
                },
                {
                    endBlock: { $gte: start, $lte: end },
                },
                {
                    startBlock: { $lte: start },
                    endBlock: { $gte: end },
                },
            ],
        };

        return await this.queryMany(criteria, currentSession, {
            epochNumber: 1,
        });
    }

    /**
     * We do not allow the usage of the last 100 blocks to avoid reorgs
     * @param blockHeight
     */
    public async getChallengeSolutionsAtHeight(blockHeight: bigint): Promise<ChallengeSolution> {
        // We need to skip one epoch. This is very important.
        const adjustedEndBlock = blockHeight - OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH;

        const epochs = await this.getEpochsInBlockRange(
            adjustedEndBlock - OPNetConsensus.consensus.EPOCH.SOLUTION_LIFETIME,
            adjustedEndBlock,
        );

        const solutions: ChallengeSolution = new AddressMap();
        for (let i = 0; i < epochs.length; i++) {
            const epoch = epochs[i];

            const minerAddress = new Address(epoch.proposer.publicKey.buffer);
            const solutionArray = solutions.get(minerAddress) || [];

            solutionArray.push(Buffer.from(epoch.proposer.solution.buffer));

            solutions.set(minerAddress, solutionArray);
        }

        return solutions;
    }

    /**
     * Get epochs by target hash
     */
    public async getEpochsByTargetHash(
        targetHash: Buffer | Binary,
        currentSession?: ClientSession,
    ): Promise<IEpochDocument[]> {
        const binaryHash = targetHash instanceof Binary ? targetHash : new Binary(targetHash);

        const criteria: Partial<Filter<IEpochDocument>> = {
            targetHash: binaryHash,
        };

        return await this.queryMany(criteria, currentSession, {
            epochNumber: -1,
        });
    }

    /**
     * Count epochs by proposer
     */
    public async countEpochsByProposer(
        proposerPublicKey: Buffer | Binary,
        currentSession?: ClientSession,
    ): Promise<number> {
        const binaryKey =
            proposerPublicKey instanceof Binary ? proposerPublicKey : new Binary(proposerPublicKey);

        const criteria: Partial<Filter<IEpochDocument>> = {
            'proposer.publicKey': binaryKey,
        };

        return await this.count(criteria, currentSession);
    }

    /**
     * Save or update an epoch
     */
    public async saveEpoch(epoch: IEpochDocument, currentSession?: ClientSession): Promise<void> {
        const criteria: Partial<Filter<IEpochDocument>> = {
            epochNumber: epoch.epochNumber,
        };

        await this.updatePartial(criteria, epoch, currentSession);
    }

    /**
     * Update epoch end block
     */
    public async updateEpochEndBlock(
        epochNumber: bigint,
        endBlock: bigint,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<IEpochDocument>> = {
            epochNumber: DataConverter.toDecimal128(epochNumber),
        };

        const update = {
            $set: {
                endBlock: DataConverter.toDecimal128(endBlock),
            },
        };

        await this.getCollection().updateOne(criteria, update, { session: currentSession });
    }

    public async deleteEpochFromBitcoinBlockNumber(
        bitcoinBlockNumber: bigint,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<IEpochDocument>> = {
            startBlock: {
                $gte: DataConverter.toDecimal128(bitcoinBlockNumber),
            },
        };

        await this.delete(criteria, currentSession);
    }

    /**
     * Get epochs with specific difficulty
     */
    public async getEpochsByDifficulty(
        minDifficulty: string,
        maxDifficulty?: string,
        currentSession?: ClientSession,
    ): Promise<IEpochDocument[]> {
        const criteria: Partial<Filter<IEpochDocument>> = {
            difficultyScaled: {
                $gte: minDifficulty,
                ...(maxDifficulty && { $lte: maxDifficulty }),
            },
        };

        return await this.queryMany(criteria, currentSession, {
            epochNumber: -1,
        });
    }

    protected override getCollection(): Collection<IEpochDocument> {
        return this._db.collection(OPNetCollections.Epochs);
    }

    private async count(
        criteria: Partial<Filter<IEpochDocument>>,
        currentSession?: ClientSession,
    ): Promise<number> {
        return await this.getCollection().countDocuments(criteria, { session: currentSession });
    }
}
