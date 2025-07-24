import { BaseRepository } from '@btc-vision/bsi-common';
import { Binary, ClientSession, Collection, Db, Filter } from 'mongodb';
import { IEpochDocument } from '../documents/interfaces/IEpochDocument.js';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';
import { DataConverter } from '@btc-vision/bsi-db';
import { SafeBigInt } from '../../api/routes/safe/BlockParamsConverter.js';

export interface EpochStats {
    readonly totalEpochs: number;
    readonly averageDifficulty: number;
    readonly uniqueMiners: number;
}

export class EpochRepository extends BaseRepository<IEpochDocument> {
    public readonly logColor: string = '#ffd700'; // Gold color for epochs

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

    /**
     * Delete epochs from a specific epoch number onwards
     */
    public async deleteEpochsFromNumber(
        epochNumber: bigint,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<IEpochDocument>> = {
            epochNumber: {
                $gte: DataConverter.toDecimal128(epochNumber),
            },
        };

        await this.delete(criteria, currentSession);
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

    /**
     * Get epochs with graffiti
     */
    public async getEpochsWithGraffiti(currentSession?: ClientSession): Promise<IEpochDocument[]> {
        const criteria: Partial<Filter<IEpochDocument>> = {
            'proposer.graffiti': { $exists: true },
        };

        return await this.queryMany(criteria, currentSession, {
            epochNumber: -1,
        });
    }

    /**
     * Get epoch statistics for a given time range (by block numbers)
     */
    public async getEpochStats(
        startBlock: number,
        endBlock: number,
        currentSession?: ClientSession,
    ): Promise<EpochStats> {
        const pipeline = [
            {
                $match: {
                    startBlock: { $gte: startBlock },
                    endBlock: { $lte: endBlock, $ne: -1 },
                },
            },
            {
                $group: {
                    _id: null,
                    totalEpochs: { $sum: 1 },
                    avgDifficulty: { $avg: { $toDouble: '$difficultyScaled' } },
                    miners: { $addToSet: '$proposer.publicKey' },
                },
            },
            {
                $project: {
                    totalEpochs: 1,
                    averageDifficulty: '$avgDifficulty',
                    uniqueMiners: { $size: '$miners' },
                },
            },
        ];

        const result = await this.getCollection()
            .aggregate(pipeline, { session: currentSession })
            .toArray();

        if (result.length === 0) {
            return {
                totalEpochs: 0,
                averageDifficulty: 0,
                uniqueMiners: 0,
            };
        }

        return result[0] as {
            totalEpochs: number;
            averageDifficulty: number;
            uniqueMiners: number;
        };
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
