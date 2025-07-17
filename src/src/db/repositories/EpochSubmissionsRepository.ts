import { BaseRepository } from '@btc-vision/bsi-common';
import { Binary, ClientSession, Collection, Db, Decimal128, Filter } from 'mongodb';
import { IEpochSubmissionsDocument } from '../documents/interfaces/IEpochSubmissionsDocument.js';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';
import { DataConverter } from '@btc-vision/bsi-db';

export interface EpochSubmissionStats {
    readonly totalSubmissions: number;
    readonly uniqueSubmitters: number;
    readonly averageBlocksToAcceptance: number;
}

export interface SubmissionsByEpoch {
    readonly epochNumber: Decimal128;
    readonly submissions: IEpochSubmissionsDocument[];
}

export class EpochSubmissionRepository extends BaseRepository<IEpochSubmissionsDocument> {
    public readonly logColor: string = '#ff6347'; // Tomato color for submissions

    public constructor(db: Db) {
        super(db);
    }

    /**
     * Get all submissions for a specific epoch number
     */
    public async getSubmissionsByEpochNumber(
        epochNumber: bigint,
        currentSession?: ClientSession,
    ): Promise<IEpochSubmissionsDocument[]> {
        const criteria: Partial<Filter<IEpochSubmissionsDocument>> = {
            epochNumber: DataConverter.toDecimal128(epochNumber),
        };

        return await this.queryMany(criteria, currentSession, {
            acceptedAt: 1,
        });
    }

    /**
     * Get submission by transaction hash
     */
    public async getSubmissionByTxHash(
        txHash: Buffer | Binary,
        currentSession?: ClientSession,
    ): Promise<IEpochSubmissionsDocument | undefined> {
        const binaryHash = txHash instanceof Binary ? txHash : new Binary(txHash);

        const criteria: Partial<Filter<IEpochSubmissionsDocument>> = {
            submissionTxHash: binaryHash,
        };

        const result: IEpochSubmissionsDocument | null = await this.queryOne(
            criteria,
            currentSession,
        );

        if (result === null) {
            return;
        }

        return result;
    }

    /**
     * Get submission by transaction ID
     */
    public async getSubmissionByTxId(
        txId: Buffer | Binary,
        currentSession?: ClientSession,
    ): Promise<IEpochSubmissionsDocument | undefined> {
        const binaryId = txId instanceof Binary ? txId : new Binary(txId);

        const criteria: Partial<Filter<IEpochSubmissionsDocument>> = {
            submissionTxId: binaryId,
        };

        const result: IEpochSubmissionsDocument | null = await this.queryOne(
            criteria,
            currentSession,
        );

        if (result === null) {
            return;
        }

        return result;
    }

    /**
     * Get submissions accepted within a block range
     */
    public async getSubmissionsInBlockRange(
        startBlock: bigint,
        endBlock: bigint,
        currentSession?: ClientSession,
    ): Promise<IEpochSubmissionsDocument[]> {
        const start = DataConverter.toDecimal128(startBlock);
        const end = DataConverter.toDecimal128(endBlock);

        const criteria: Partial<Filter<IEpochSubmissionsDocument>> = {
            confirmedAt: {
                $gte: start,
                $lte: end,
            },
        };

        return await this.queryMany(criteria, currentSession, {
            acceptedAt: 1,
        });
    }

    /**
     * Get submissions by proposer public key
     */
    public async getSubmissionsByProposer(
        proposerPublicKey: Buffer | Binary,
        currentSession?: ClientSession,
    ): Promise<IEpochSubmissionsDocument[]> {
        const binaryKey =
            proposerPublicKey instanceof Binary ? proposerPublicKey : new Binary(proposerPublicKey);

        const criteria: Partial<Filter<IEpochSubmissionsDocument>> = {
            'epochProposed.publicKey': binaryKey,
        };

        return await this.queryMany(criteria, currentSession, {
            acceptedAt: -1,
        });
    }

    /**
     * Get pending submissions (not yet accepted)
     */
    public async getPendingSubmissions(
        fromBlock: bigint,
        currentSession?: ClientSession,
    ): Promise<IEpochSubmissionsDocument[]> {
        const block = DataConverter.toDecimal128(fromBlock);

        const criteria: Partial<Filter<IEpochSubmissionsDocument>> = {
            startBlock: { $gte: block },
            confirmedAt: { $gt: block },
        };

        return await this.queryMany(criteria, currentSession, {
            startBlock: 1,
        });
    }

    /**
     * Get submissions by submission hash
     */
    public async getSubmissionByHash(
        submissionHash: Buffer | Binary,
        currentSession?: ClientSession,
    ): Promise<IEpochSubmissionsDocument | undefined> {
        const binaryHash =
            submissionHash instanceof Binary ? submissionHash : new Binary(submissionHash);

        const criteria: Partial<Filter<IEpochSubmissionsDocument>> = {
            submissionHash: binaryHash,
        };

        const result: IEpochSubmissionsDocument | null = await this.queryOne(
            criteria,
            currentSession,
        );

        if (result === null) {
            return;
        }

        return result;
    }

    /**
     * Save epoch submission
     */
    public async saveSubmission(
        submission: IEpochSubmissionsDocument,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<IEpochSubmissionsDocument>> = {
            submissionTxHash: submission.submissionTxHash,
        };

        await this.updatePartial(criteria, submission, currentSession);
    }

    /**
     * Delete submissions from a specific block height onwards
     */
    public async deleteSubmissionsFromBlock(
        blockHeight: bigint,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<IEpochSubmissionsDocument>> = {
            confirmedAt: {
                $gte: DataConverter.toDecimal128(blockHeight),
            },
        };

        await this.delete(criteria, currentSession);
    }

    /**
     * Delete submissions for epochs from a specific epoch number onwards
     */
    public async deleteSubmissionsFromEpochNumber(
        epochNumber: bigint,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<IEpochSubmissionsDocument>> = {
            epochNumber: {
                $gte: DataConverter.toDecimal128(epochNumber),
            },
        };

        await this.delete(criteria, currentSession);
    }

    /**
     * Get the latest submission
     */
    public async getLatestSubmission(
        currentSession?: ClientSession,
    ): Promise<IEpochSubmissionsDocument | undefined> {
        const criteria: Partial<Filter<IEpochSubmissionsDocument>> = {};
        const result: IEpochSubmissionsDocument | null = await this.queryOne(
            criteria,
            currentSession,
            {
                acceptedAt: -1,
            },
        );

        if (result === null) {
            return;
        }

        return result;
    }

    /**
     * Get submissions with graffiti
     */
    public async getSubmissionsWithGraffiti(
        currentSession?: ClientSession,
    ): Promise<IEpochSubmissionsDocument[]> {
        const criteria: Partial<Filter<IEpochSubmissionsDocument>> = {
            'epochProposed.graffiti': { $exists: true },
        };

        return await this.queryMany(criteria, currentSession, {
            acceptedAt: -1,
        });
    }

    /**
     * Check if a submission exists
     */
    public async submissionExists(
        publicKey: Buffer | Binary,
        salt: Buffer | Binary,
        epochNumber: bigint,
    ): Promise<boolean> {
        const criteria: Partial<Filter<IEpochSubmissionsDocument>> = {
            epochNumber: DataConverter.toDecimal128(epochNumber),
            'epochProposed.publicKey':
                publicKey instanceof Binary ? publicKey : new Binary(publicKey),
            'epochProposed.salt': salt instanceof Binary ? salt : new Binary(salt),
        };

        const count = await this.count(criteria);
        return count > 0;
    }

    /**
     * Get competing submissions for the same epoch
     */
    public async getCompetingSubmissions(
        epochNumber: bigint,
        startBlock: bigint,
        currentSession?: ClientSession,
    ): Promise<IEpochSubmissionsDocument[]> {
        const criteria: Partial<Filter<IEpochSubmissionsDocument>> = {
            epochNumber: DataConverter.toDecimal128(epochNumber),
            startBlock: DataConverter.toDecimal128(startBlock),
        };

        return await this.queryMany(criteria, currentSession, {
            acceptedAt: 1,
        });
    }

    /**
     * Get submission statistics for a block range
     */
    public async getSubmissionStats(
        startBlock: bigint,
        endBlock: bigint,
        currentSession?: ClientSession,
    ): Promise<EpochSubmissionStats> {
        const pipeline = [
            {
                $match: {
                    acceptedAt: {
                        $gte: DataConverter.toDecimal128(startBlock),
                        $lte: DataConverter.toDecimal128(endBlock),
                    },
                },
            },
            {
                $group: {
                    _id: null,
                    totalSubmissions: { $sum: 1 },
                    submitters: { $addToSet: '$epochProposed.publicKey' },
                    avgBlocksToAcceptance: {
                        $avg: {
                            $subtract: [{ $toDouble: '$acceptedAt' }, { $toDouble: '$startBlock' }],
                        },
                    },
                },
            },
            {
                $project: {
                    totalSubmissions: 1,
                    uniqueSubmitters: { $size: '$submitters' },
                    averageBlocksToAcceptance: '$avgBlocksToAcceptance',
                },
            },
        ];

        const result = await this.getCollection()
            .aggregate(pipeline, { session: currentSession })
            .toArray();

        if (result.length === 0) {
            return {
                totalSubmissions: 0,
                uniqueSubmitters: 0,
                averageBlocksToAcceptance: 0,
            };
        }

        return result[0] as EpochSubmissionStats;
    }

    /**
     * Get submissions grouped by epoch number
     */
    public async getSubmissionsGroupedByEpoch(
        limit: number = 10,
        currentSession?: ClientSession,
    ): Promise<SubmissionsByEpoch[]> {
        const pipeline = [
            {
                $sort: { epochNumber: -1 },
            },
            {
                $group: {
                    _id: '$epochNumber',
                    submissions: { $push: '$$ROOT' },
                },
            },
            {
                $project: {
                    epochNumber: '$_id',
                    submissions: 1,
                    _id: 0,
                },
            },
            {
                $limit: limit,
            },
        ];

        return (await this.getCollection()
            .aggregate(pipeline, { session: currentSession })
            .toArray()) as SubmissionsByEpoch[];
    }

    protected override getCollection(): Collection<IEpochSubmissionsDocument> {
        return this._db.collection(OPNetCollections.EpochSubmissions);
    }

    private async count(
        criteria: Partial<Filter<IEpochSubmissionsDocument>>,
        currentSession?: ClientSession,
    ): Promise<number> {
        return await this.getCollection().countDocuments(criteria, { session: currentSession });
    }
}
