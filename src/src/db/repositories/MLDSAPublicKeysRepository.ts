import {
    AnyBulkWriteOperation,
    Binary,
    ClientSession,
    Collection,
    Db,
    Document,
    Filter,
    Long,
} from 'mongodb';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';
import {
    IMLDSAPublicKey,
    MLDSAPublicKeyDocument,
    MLDSAUpdateData,
} from '../interfaces/IMLDSAPublicKey.js';
import { ExtendedBaseRepository } from './ExtendedBaseRepository.js';
import { MLDSASecurityLevel } from '@btc-vision/transaction';

export interface MLDSAPublicKeyExists {
    readonly hashedExists: boolean;
    readonly legacyExists: boolean;
    readonly sameId: boolean;
    readonly level: MLDSASecurityLevel | null;
    readonly publicKeyExists?: boolean;
}

export class MLDSAPublicKeyRepository extends ExtendedBaseRepository<MLDSAPublicKeyDocument> {
    public readonly logColor: string = '#d4a5ff';

    public constructor(db: Db) {
        super(db);
    }

    public async deleteFromBlockHeight(
        blockHeight: bigint,
        currentSession?: ClientSession,
    ): Promise<void> {
        // We must null all the elements first before deleting to maintain historical integrity
        await this.nullPublicKeyFromBlockHeight(blockHeight, currentSession);

        const criteria: Partial<Filter<MLDSAPublicKeyDocument>> = {
            insertedBlockHeight: { $gte: Long.fromBigInt(blockHeight) },
        };

        await this.delete(criteria, currentSession);
    }

    public async nullPublicKeyFromBlockHeight(
        blockHeight: bigint,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<MLDSAPublicKeyDocument>> = {
            exposedBlockHeight: { $gte: Long.fromBigInt(blockHeight) },
        };

        const update: Partial<MLDSAPublicKeyDocument> = {
            publicKey: null,
            exposedBlockHeight: null,
        };

        await this.updateMany(criteria, update, currentSession);
    }

    public async savePublicKeys(keys: MLDSAUpdateData[]): Promise<void> {
        const bulkWriteOperations: AnyBulkWriteOperation<MLDSAPublicKeyDocument>[] = keys.map(
            (key) => {
                if (!key.exposePublicKey) {
                    if (key.data.insertedBlockHeight === null) {
                        throw new Error('Inserted block height is required for new public keys');
                    }

                    const documentToInsert: MLDSAPublicKeyDocument = this.toDocument(
                        key.data,
                        true,
                    );

                    return {
                        insertOne: {
                            document: documentToInsert,
                        },
                    };
                } else {
                    const documentUpdate: Omit<MLDSAPublicKeyDocument, 'insertedBlockHeight'> =
                        this.toDocument(key.data, false);

                    if (documentUpdate.legacyPublicKey.length() !== 33) {
                        throw new Error('Legacy public key must be 33 bytes long');
                    }

                    return {
                        updateOne: {
                            filter: {
                                hashedPublicKey: documentUpdate.hashedPublicKey,
                                legacyPublicKey: documentUpdate.legacyPublicKey,
                                tweakedPublicKey: documentUpdate.tweakedPublicKey,
                            },
                            update: {
                                $set: {
                                    publicKey: documentUpdate.publicKey,
                                    exposedBlockHeight: documentUpdate.exposedBlockHeight,
                                },
                            },
                            upsert: false,
                        },
                    };
                }
            },
        );

        console.log(bulkWriteOperations);

        await this.bulkWrite(bulkWriteOperations);
    }

    public async getByHashedPublicKey(
        hashedPublicKey: Buffer | Binary | string,
        blockHeight: bigint,
        currentSession?: ClientSession,
    ): Promise<IMLDSAPublicKey | null> {
        const binHash: Binary = this.toBinary(hashedPublicKey);

        const criteria: Document = {
            hashedPublicKey: binHash,
            insertedBlockHeight: { $lte: Long.fromBigInt(blockHeight) },
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
            insertedBlockHeight: { $lte: Long.fromBigInt(blockHeight) },
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
            insertedBlockHeight: { $lte: Long.fromBigInt(blockHeight) },
            $or: [
                { hashedPublicKey: binKey },
                { legacyPublicKey: binKey },
                { tweakedPublicKey: binKey },
            ],
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
        // Convert to binary first, then validate lengths (handles hex strings correctly)
        const binHashed: Binary = this.toBinary(hashedPublicKey);
        const binLegacy: Binary = this.toBinary(legacyPublicKey);

        if (binHashed.length() !== 32 || binLegacy.length() !== 33) {
            throw new Error('Invalid public key lengths provided to compare existence');
        }

        const collection = this.getCollection();

        const [hashedResult, legacyResult] = await Promise.all([
            collection.findOne(
                { hashedPublicKey: binHashed },
                { projection: { _id: 1, level: 1, exposedBlockHeight: 1 } },
            ),
            collection.findOne(
                { legacyPublicKey: binLegacy },
                { projection: { _id: 1, level: 1 } },
            ),
        ]);

        const sameId =
            hashedResult && legacyResult ? hashedResult._id.equals(legacyResult._id) : false;

        return {
            hashedExists: hashedResult !== null,
            legacyExists: legacyResult !== null,
            sameId: sameId,
            level: hashedResult && sameId ? hashedResult.level : null,
            publicKeyExists:
                hashedResult && sameId ? hashedResult.exposedBlockHeight !== null : undefined,
        };
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
            level: result.level,
            hashedPublicKey: Buffer.from(result.hashedPublicKey.buffer),
            legacyPublicKey: Buffer.from(result.legacyPublicKey.buffer),
            tweakedPublicKey: Buffer.from(result.tweakedPublicKey.buffer),
            publicKey: result.publicKey ? Buffer.from(result.publicKey.buffer) : null,
            insertedBlockHeight: Long.isLong(result.insertedBlockHeight)
                ? result.insertedBlockHeight.toBigInt()
                : BigInt(result.insertedBlockHeight),
            exposedBlockHeight: result.exposedBlockHeight
                ? Long.isLong(result.exposedBlockHeight)
                    ? result.exposedBlockHeight.toBigInt()
                    : BigInt(result.exposedBlockHeight)
                : null,
        };
    }

    private toDocument(
        key: IMLDSAPublicKey,
        includeInsertedBlockHeight: true,
    ): MLDSAPublicKeyDocument;

    private toDocument(
        key: IMLDSAPublicKey,
        includeInsertedBlockHeight: false,
    ): Omit<MLDSAPublicKeyDocument, 'insertedBlockHeight'>;

    private toDocument(
        key: IMLDSAPublicKey,
        includeInsertedBlockHeight: boolean,
    ): MLDSAPublicKeyDocument | Omit<MLDSAPublicKeyDocument, 'insertedBlockHeight'> {
        const base = {
            level: key.level,
            hashedPublicKey: new Binary(key.hashedPublicKey),
            legacyPublicKey: new Binary(key.legacyPublicKey),
            tweakedPublicKey: new Binary(key.tweakedPublicKey),
            publicKey: key.publicKey ? new Binary(key.publicKey) : null,
            exposedBlockHeight: key.exposedBlockHeight
                ? Long.fromBigInt(key.exposedBlockHeight)
                : null,
        };

        if (includeInsertedBlockHeight) {
            return {
                ...base,
                insertedBlockHeight: Long.fromBigInt(key.insertedBlockHeight as bigint),
            };
        }

        return base;
    }
}
