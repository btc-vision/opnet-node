import { Collection, Db, Filter, ObjectId, Sort, OptionalUnlessRequiredId } from 'mongodb';
import { Logger } from '../../logger/Logger.js';
import { DBManagerInstance } from '../DBManager.js';
import { IBaseDocument } from '../documents/interfaces/IBaseDocument.js';
import { PagingQueryInfo, PagingQueryResult } from './PagingQuery.js';
import { DataAccessError, DataAccessErrorType } from '../../errors/DataAccessError.js';
import { DBConstants } from '../DBConstants.js';

export abstract class Repository<TDocument extends IBaseDocument> extends Logger {
    private readonly _db?: Db;

    public async deleteById(id: ObjectId): Promise<boolean> {
        try {
            const collection = this.getCollection();
            const filter: Partial<Filter<TDocument>> = {
                _id: id,
            } as Partial<Filter<TDocument>>;

            const result = await collection.deleteOne(filter);

            return result.deletedCount === 1;
        } catch (error) {
            if (error instanceof Error) {
                throw new DataAccessError(
                    error.message,
                    DataAccessErrorType.Unknown,
                    `id: ${id.toString()}`,
                );
            } else {
                throw error;
            }
        }
    }

    public async delete(document: TDocument): Promise<boolean> {
        return await this.deleteById(document._id);
    }

    public async getAll(criteria?: Partial<Filter<TDocument>>): Promise<TDocument[]> {
        try {
            const collection = this.getCollection();
            const query = criteria || {};
            return (await collection.find(query).toArray()) as TDocument[];
        } catch (error) {
            if (error instanceof Error) {
                throw new DataAccessError(error.message);
            } else {
                throw error;
            }
        }
    }

    public async getById(id: ObjectId): Promise<TDocument | null> {
        try {
            const collection = this.getCollection();
            const filter: Partial<Filter<TDocument>> = {
                _id: id,
            } as Partial<Filter<TDocument>>;
            return (await collection.findOne(filter)) as TDocument | null;
        } catch (error) {
            if (error instanceof Error) {
                throw new DataAccessError(
                    error.message,
                    DataAccessErrorType.Unknown,
                    `id: ${id.toString()}`,
                );
            } else {
                throw error;
            }
        }
    }

    public async getCount(criteria?: Partial<Filter<TDocument>>): Promise<number> {
        try {
            const collection = this.getCollection();
            const query = criteria || {};
            return await collection.countDocuments(query);
        } catch (error) {
            if (error instanceof Error) {
                throw new DataAccessError(error.message);
            } else {
                throw error;
            }
        }
    }

    public async queryOne(criteria: Partial<Filter<TDocument>>): Promise<TDocument | null> {
        try {
            const collection = this.getCollection();
            return (await collection.findOne(criteria)) as TDocument;
        } catch (error) {
            if (error instanceof Error) {
                throw new DataAccessError(error.message);
            } else {
                throw error;
            }
        }
    }

    public async queryMany(criteria: Partial<Filter<TDocument>>): Promise<TDocument[]> {
        try {
            const collection = this.getCollection();
            return (await collection.find(criteria).toArray()) as TDocument[];
        } catch (error) {
            if (error instanceof Error) {
                throw new DataAccessError(error.message);
            } else {
                throw error;
            }
        }
    }

    public async queryManyAndSortPaged(
        criteria: Partial<Filter<TDocument>>,
        sort: Sort,
        pagingQueryInfo: PagingQueryInfo,
    ): Promise<PagingQueryResult<TDocument>> {
        try {
            const collection = this.getCollection();
            const skips = pagingQueryInfo.pageSize * (pagingQueryInfo.pageNumber - 1);
            let count: number = await this.getCount(criteria);

            const documents = await collection
                .find(criteria)
                .sort(sort)
                .skip(skips)
                .limit(pagingQueryInfo.pageSize)
                .toArray();

            return new PagingQueryResult<TDocument>(
                pagingQueryInfo.pageSize,
                pagingQueryInfo.pageNumber,
                count,
                pagingQueryInfo.pageNumber * pagingQueryInfo.pageSize < count,
                documents as TDocument[],
            );
        } catch (error) {
            if (error instanceof Error) {
                throw new DataAccessError(error.message);
            } else {
                throw error;
            }
        }
    }

    public async queryManyAndSort(
        criteria: Partial<Filter<TDocument>>,
        sort: Sort,
    ): Promise<TDocument[]> {
        try {
            const collection = this.getCollection();
            return (await collection.find(criteria).sort(sort).toArray()) as TDocument[];
        } catch (error) {
            if (error instanceof Error) {
                throw new DataAccessError(error.message);
            } else {
                throw error;
            }
        }
    }

    public async save(document: TDocument): Promise<void> {
        try {
            const collection = this.getCollection();
            const currentVersion = document.version;
            document.version = document.version + 1;

            const filter: Partial<Filter<TDocument>> = {
                _id: document._id,
                version: currentVersion,
            } as Partial<Filter<TDocument>>;

            const { _id, ...updateData } = document;

            if (_id.toString() !== DBConstants.NULL_OBJECT_ID) {
                const result = await collection.updateOne(filter, {
                    $set: updateData as Partial<TDocument>,
                });

                if (result.modifiedCount === 0) {
                    throw new DataAccessError(
                        'Concurency error while updating.',
                        DataAccessErrorType.Concurency,
                        `id ${document._id}, version: ${currentVersion}`,
                    );
                }
            } else {
                document._id = new ObjectId();
                await collection.insertOne(document as OptionalUnlessRequiredId<TDocument>);
            }
        } catch (error) {
            if (error instanceof DataAccessError) {
                throw error;
            } else if (error instanceof Error) {
                throw new DataAccessError(error.message);
            } else {
                throw error;
            }
        }
    }

    public async updatePartial(
        id: ObjectId,
        version: number,
        document: Partial<TDocument>,
    ): Promise<void> {
        try {
            const collection = this.getCollection();
            document.version = version + 1;

            const filter: Partial<Filter<TDocument>> = {
                _id: id,
                version: version,
            } as Partial<Filter<TDocument>>;

            const updateResult = await collection.updateOne(filter, { $set: document });

            if (updateResult.modifiedCount !== 1) {
                throw new DataAccessError(
                    'Concurency error while updating.',
                    DataAccessErrorType.Concurency,
                    `id ${id}, version: ${version}`,
                );
            }
        } catch (error) {
            if (error instanceof Error) {
                throw new DataAccessError(
                    error.message,
                    DataAccessErrorType.Unknown,
                    `id: ${id.toString()}`,
                );
            } else {
                throw error;
            }
        }
    }

    protected constructor(customDb?: Db) {
        super();
        this._db = customDb;
    }

    protected get db(): Db {
        if (!DBManagerInstance.db) {
            throw new DataAccessError('Database is not connected.');
        }

        if (!this._db) {
            return DBManagerInstance.db;
        } else {
            return this._db;
        }
    }

    protected abstract getCollection(): Collection<TDocument>;
}
