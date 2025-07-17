import { BaseRepository } from '@btc-vision/bsi-common';
import { Binary, ClientSession, Collection, Db, Filter, FindOptions } from 'mongodb';
import { ITargetEpochDocument } from '../documents/interfaces/ITargetEpochDocument.js';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';
import { DataConverter } from '@btc-vision/bsi-db';

export class TargetEpochRepository extends BaseRepository<ITargetEpochDocument> {
    public readonly logColor: string = '#ff1493'; // Deep pink for target epochs

    public constructor(db: Db) {
        super(db);
    }

    /**
     * Check if a target epoch exists for a specific epoch number and proposer
     */
    public async targetEpochExists(epochNumber: bigint, salt: Buffer | Binary): Promise<boolean> {
        const binarySalt = salt instanceof Binary ? salt : new Binary(salt);

        const criteria: Partial<Filter<ITargetEpochDocument>> = {
            epochNumber: DataConverter.toDecimal128(epochNumber),
            salt: binarySalt,
        };

        const count = await this.count(criteria);
        return count > 0;
    }

    public async getBestTargetEpoch(epochNumber: bigint): Promise<ITargetEpochDocument | null> {
        const criteria: Partial<Filter<ITargetEpochDocument>> = {
            epochNumber: DataConverter.toDecimal128(epochNumber),
        };

        const options: FindOptions = {
            sort: { difficulty: -1 },
        };

        return await this.getCollection().findOne(criteria, options);
    }

    /**
     * Save or update a target epoch
     */
    public async saveTargetEpoch(targetEpoch: ITargetEpochDocument): Promise<void> {
        const criteria: Partial<Filter<ITargetEpochDocument>> = {
            epochNumber: targetEpoch.epochNumber,
            salt: targetEpoch.salt,
        };

        const update = {
            $set: targetEpoch,
        };

        const options = {
            upsert: true,
        };

        await this.getCollection().updateOne(criteria, update, options);
    }

    /**
     * Delete old target epochs
     */
    public async deleteOldTargetEpochs(epochNumber: bigint): Promise<void> {
        const criteria: Partial<Filter<ITargetEpochDocument>> = {
            epochNumber: {
                $lte: DataConverter.toDecimal128(epochNumber),
            },
        };

        await this.delete(criteria);
    }

    protected override getCollection(): Collection<ITargetEpochDocument> {
        return this._db.collection(OPNetCollections.TargetEpochs);
    }

    private async count(
        criteria: Partial<Filter<ITargetEpochDocument>>,
        currentSession?: ClientSession,
    ): Promise<number> {
        return await this.getCollection().countDocuments(criteria, { session: currentSession });
    }
}
