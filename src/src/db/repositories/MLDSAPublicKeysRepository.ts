import { BaseRepository, DataAccessError, DataAccessErrorType } from '@btc-vision/bsi-common';
import {
    AnyBulkWriteOperation,
    Binary,
    BulkWriteOptions,
    BulkWriteResult,
    ClientSession,
    Collection,
    Db,
    Document,
    Filter,
    Long,
} from 'mongodb';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';
import { IMLDSAPublicKey, MLDSAPublicKeyDocument } from '../interfaces/IMLDSAPublicKey.js';

export interface MLDSAPublicKeyExists {
    readonly hashedExists: boolean;
    readonly legacyExists: boolean;
}

export class MLDSAPublicKeyRepository extends BaseRepository<MLDSAPublicKeyDocument> {
    public readonly logColor: string = '#d4a5ff';

    public constructor(db: Db) {
        super(db);
    }

    public async deleteFromBlockHeight(
        blockHeight: bigint,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<MLDSAPublicKeyDocument>> = {
            blockHeight: { $gte: Long.fromBigInt(blockHeight) },
        };

        await this.delete(criteria, currentSession);
    }

    public async bulkWrite(
        operations: AnyBulkWriteOperation<MLDSAPublicKeyDocument>[],
    ): Promise<void> {
        if (operations.length === 0) {
            return;
        }

        try {
            const collection = this.getCollection();
            const options: BulkWriteOptions = this.getOptions();
            options.ordered = true;
            options.writeConcern = { w: 1 };
            options.maxTimeMS = 512_000;
            options.timeoutMS = 512_000;

            const result: BulkWriteResult = await collection.bulkWrite(operations, options);

            if (result.hasWriteErrors()) {
                for (const error of result.getWriteErrors()) {
                    if (error.code === 11000) {
                        throw new Error(`Duplicate key violation: ${error.errmsg}`);
                    }

                    this.error(`Bulk write error: ${error}`);
                }

                throw new DataAccessError('Failed to bulk write.', DataAccessErrorType.Unknown, '');
            }

            if (!result.isOk()) {
                throw new DataAccessError('Failed to bulk write.', DataAccessErrorType.Unknown, '');
            }
        } catch (error) {
            if (error instanceof DataAccessError) {
                throw error;
            }

            if (error instanceof Error) {
                if ('code' in error && error.code === 11000) {
                    throw new Error(`Duplicate key violation: ${error.message}`);
                }

                const errorDescription: string = error.stack || error.message;
                throw new DataAccessError(errorDescription, DataAccessErrorType.Unknown, '');
            }

            throw error;
        }
    }

    public async savePublicKeys(keys: IMLDSAPublicKey[]): Promise<void> {
        const bulkWriteOperations: AnyBulkWriteOperation<MLDSAPublicKeyDocument>[] = keys.map(
            (key) => {
                const document: MLDSAPublicKeyDocument = this.toDocument(key);

                return {
                    insertOne: {
                        document,
                    },
                };
            },
        );

        await this.bulkWrite(bulkWriteOperations);
    }

    public async savePublicKey(key: IMLDSAPublicKey): Promise<void> {
        const document: MLDSAPublicKeyDocument = this.toDocument(key);

        try {
            const collection = this.getCollection();
            await collection.insertOne(document, this.getOptions());
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 11000) {
                throw new Error(
                    `Duplicate key violation: hashedPublicKey or legacyPublicKey already exists`,
                );
            }

            if (error instanceof Error) {
                const errorDescription: string = error.stack || error.message;
                throw new DataAccessError(errorDescription, DataAccessErrorType.Unknown, '');
            }

            throw error;
        }
    }

    public async getByHashedPublicKey(
        hashedPublicKey: Buffer | Binary | string,
        blockHeight: bigint,
        currentSession?: ClientSession,
    ): Promise<IMLDSAPublicKey | null> {
        const binHash: Binary = this.toBinary(hashedPublicKey);

        const criteria: Document = {
            hashedPublicKey: binHash,
            blockHeight: { $lte: Long.fromBigInt(blockHeight) },
        };
        const result = await this.queryOne(criteria, currentSession);

        if (result) {
            delete (result as Document)._id;
        }

        return result ? this.parseResult(result) : null;
    }

    public async getByLegacyPublicKey(
        legacyPublicKey: Buffer | Binary | string,
        blockHeight: bigint,
        currentSession?: ClientSession,
    ): Promise<IMLDSAPublicKey | null> {
        const binKey: Binary = this.toBinary(legacyPublicKey);

        const criteria: Document = {
            legacyPublicKey: binKey,
            blockHeight: { $lte: Long.fromBigInt(blockHeight) },
        };
        const result = await this.queryOne(criteria, currentSession);

        if (result) {
            delete (result as Document)._id;
        }

        return result ? this.parseResult(result) : null;
    }

    public async getByHashedOrLegacy(
        key: Buffer | Binary | string,
        blockHeight: bigint,
        currentSession?: ClientSession,
    ): Promise<IMLDSAPublicKey | null> {
        const binKey: Binary = this.toBinary(key);

        const criteria: Document = {
            blockHeight: { $lte: Long.fromBigInt(blockHeight) },
            $or: [{ hashedPublicKey: binKey }, { legacyPublicKey: binKey }],
        };

        const result = await this.queryOne(criteria, currentSession);
        if (result) {
            delete (result as Document)._id;
        }

        return result ? this.parseResult(result) : null;
    }

    public async exists(
        hashedPublicKey: Buffer | Binary | string,
        legacyPublicKey: Buffer | Binary | string,
    ): Promise<MLDSAPublicKeyExists> {
        const binHashed: Binary = this.toBinary(hashedPublicKey);
        const binLegacy: Binary = this.toBinary(legacyPublicKey);

        const collection = this.getCollection();

        const [hashedResult, legacyResult] = await Promise.all([
            collection.findOne({ hashedPublicKey: binHashed }, { projection: { _id: 1 } }),
            collection.findOne({ legacyPublicKey: binLegacy }, { projection: { _id: 1 } }),
        ]);

        return {
            hashedExists: hashedResult !== null,
            legacyExists: legacyResult !== null,
        };
    }

    public async getPublicKeysByBlockHeight(
        blockHeight: bigint,
        currentSession?: ClientSession,
    ): Promise<MLDSAPublicKeyDocument[]> {
        const criteria: Partial<MLDSAPublicKeyDocument> = {
            blockHeight: Long.fromBigInt(blockHeight),
        };

        return await this.getAll(criteria, currentSession);
    }

    protected override getCollection(): Collection<MLDSAPublicKeyDocument> {
        return this._db.collection(OPNetCollections.MLDSAPublicKeys);
    }

    private toBinary(value: Buffer | Binary | string): Binary {
        if (value instanceof Binary) {
            return value;
        }

        if (typeof value === 'string') {
            return new Binary(Buffer.from(value, 'hex'));
        }

        return new Binary(value);
    }

    private parseResult(result: MLDSAPublicKeyDocument): IMLDSAPublicKey {
        return {
            hashedPublicKey: Buffer.from(result.hashedPublicKey.buffer),
            legacyPublicKey: Buffer.from(result.legacyPublicKey.buffer),
            publicKey: Buffer.from(result.publicKey.buffer),
            blockHeight: result.blockHeight.toBigInt(),
        };
    }

    private toDocument(key: IMLDSAPublicKey): MLDSAPublicKeyDocument {
        return {
            hashedPublicKey: new Binary(key.hashedPublicKey),
            legacyPublicKey: new Binary(key.legacyPublicKey),
            publicKey: new Binary(key.publicKey),
            blockHeight: Long.fromBigInt(key.blockHeight),
        };
    }
}
