import { BaseRepository, DataConverter } from '@btc-vision/bsi-common';
import { Binary, ClientSession, Collection, Db, Filter } from 'mongodb';
import { IEpochSubmissionsDocument } from '../documents/interfaces/IEpochSubmissionsDocument.js';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';

export class EpochSubmissionRepository extends BaseRepository<IEpochSubmissionsDocument> {
    public readonly logColor: string = '#ff6347';

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
            confirmedAt: 1,
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
            confirmedAt: 1,
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
            'epochProposed.mldsaPublicKey': binaryKey,
        };

        return await this.queryMany(criteria, currentSession, {
            confirmedAt: -1,
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
                confirmedAt: -1,
            },
        );

        if (result === null) {
            return;
        }

        return result;
    }

    /**
     * Check if a submission exists
     */
    public async submissionExists(
        mldsaPublicKey: Buffer | Binary,
        salt: Buffer | Binary,
        epochNumber: bigint,
    ): Promise<boolean> {
        const criteria: Partial<Filter<IEpochSubmissionsDocument>> = {
            epochNumber: DataConverter.toDecimal128(epochNumber),
            'epochProposed.mldsaPublicKey':
                mldsaPublicKey instanceof Binary ? mldsaPublicKey : new Binary(mldsaPublicKey),
            'epochProposed.salt': salt instanceof Binary ? salt : new Binary(salt),
        };

        const count = await this.count(criteria);
        return count > 0;
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
