import {
    CurrentOpOutput,
    OperationDetails,
} from '../../vm/storage/interfaces/StorageInterfaces.js';
import { BaseRepository, DataAccessError, DataAccessErrorType } from '@btc-vision/bsi-common';
import { IBaseDocument } from '@btc-vision/bsi-common/src/db/documents/interfaces/IBaseDocument.js';
import {
    AnyBulkWriteOperation,
    BulkWriteOptions,
    BulkWriteResult,
    ClientSession,
    Decimal128,
    Filter,
    Long,
    UpdateOptions,
} from 'mongodb';

export abstract class ExtendedBaseRepository<T extends IBaseDocument> extends BaseRepository<T> {
    public bigIntToLong(bigInt: bigint): Long {
        return Long.fromBigInt(bigInt);
    }

    public decimal128ToLong(decimal128: Decimal128 | string): Long {
        return Long.fromString(decimal128.toString());
    }

    public async updateMany(
        criteria: Partial<Filter<T>>,
        document: Partial<T>,
        currentSession?: ClientSession,
    ): Promise<void> {
        try {
            const collection = this.getCollection();
            const options: UpdateOptions = {
                ...this.getOptions(currentSession),
                upsert: false,
            };

            const updateResult = await collection.updateMany(criteria, { $set: document }, options);

            if (!updateResult.acknowledged) {
                throw new DataAccessError(
                    'Concurrency error while updating.',
                    DataAccessErrorType.Concurency,
                    '',
                );
            }
        } catch (error) {
            if (error instanceof Error) {
                const errorDescription: string = error.stack || error.message;

                throw new DataAccessError(errorDescription, DataAccessErrorType.Unknown, '');
            } else {
                throw error;
            }
        }
    }

    public async bulkWrite(operations: AnyBulkWriteOperation<T>[]): Promise<void> {
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
                    throw new Error(`Duplicate key violation: ${error.message}`, { cause: error });
                }

                const errorDescription: string = error.stack || error.message;
                throw new DataAccessError(errorDescription, DataAccessErrorType.Unknown, '');
            }

            throw error;
        }
    }

    protected chunkArray<T>(array: T[], size: number): T[][] {
        return array.reduce<T[][]>((acc, _, i) => {
            if (i % size === 0) {
                acc.push(array.slice(i, i + size));
            }

            return acc;
        }, []);
    }

    protected async waitForAllSessionsCommitted(pollInterval: number = 100): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            const checkWrites = async (): Promise<boolean> => {
                if (!this._db) {
                    throw new Error('Database not connected');
                }

                try {
                    // Fetch the current operations using currentOp command
                    const result = (await this._db.admin().command({
                        currentOp: true,
                    })) as CurrentOpOutput;

                    // Filter write operations (insert, update, delete, findAndModify)
                    const writeOps = result.inprog.filter((op: OperationDetails) => {
                        if (
                            (op.active && op.transaction) ||
                            op.op === 'insert' ||
                            op.op === 'update' ||
                            op.op === 'remove'
                        ) {
                            return true;
                        }
                    });

                    // If no write operations are active, resolve true
                    return writeOps.length === 0;
                } catch (error) {
                    console.error('Error checking write operations:', error);
                    reject(error as Error);
                    return false;
                }
            };

            // Polling function
            const poll = async () => {
                const writesFinished = await checkWrites();
                if (writesFinished) {
                    resolve();
                } else {
                    setTimeout(poll, pollInterval);
                }
            };

            // Start polling
            await poll();
        });
    }
}
