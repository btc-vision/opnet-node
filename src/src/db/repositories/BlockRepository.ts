import { BaseRepository, DataConverter } from '@btc-vision/bsi-common';
import {
    AnyBulkWriteOperation,
    BulkWriteOptions,
    ClientSession,
    Collection,
    Db,
    Decimal128,
    Filter,
} from 'mongodb';
import {
    BlockHeaderDocument,
    IBlockHeaderBlockDocument,
} from '../interfaces/IBlockHeaderBlockDocument.js';

export class BlockRepository extends BaseRepository<IBlockHeaderBlockDocument> {
    public readonly logColor: string = '#afeeee';

    public constructor(db: Db) {
        super(db);
    }

    public async deleteBlockHeadersFromBlockHeight(
        height: bigint,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<IBlockHeaderBlockDocument>> = {
            height: {
                $gte: DataConverter.toDecimal128(height),
            },
        };

        await this.delete(criteria, currentSession);
    }

    public async getLatestBlock(
        currentSession?: ClientSession,
    ): Promise<IBlockHeaderBlockDocument | undefined> {
        const criteria: Partial<Filter<IBlockHeaderBlockDocument>> = {};
        const result: IBlockHeaderBlockDocument | null = await this.queryOne(
            criteria,
            currentSession,
            {
                height: -1,
            },
        );

        if (result === null) {
            return;
        }

        return result;
    }

    public async getBlockByHash(
        hash: string,
        checksum: boolean,
    ): Promise<IBlockHeaderBlockDocument | undefined> {
        const criteria: Partial<BlockHeaderDocument> = {};

        if (!checksum) {
            criteria.hash = hash;
        } else {
            criteria.checksumRoot = '0x' + hash.replace('0x', ''); // Always have 0x.
        }

        const result: IBlockHeaderBlockDocument | null = await this.queryOne(criteria);
        if (result === null) {
            return;
        }

        return result;
    }

    public async getBlockHeader(height: bigint): Promise<IBlockHeaderBlockDocument | undefined> {
        const criteria: Partial<Filter<IBlockHeaderBlockDocument>> = {
            height: DataConverter.toDecimal128(height),
        };

        const result: IBlockHeaderBlockDocument | null = await this.queryOne(criteria);
        if (result === null) {
            return;
        }

        return result;
    }

    /** Save block headers */
    public async saveBlockHeader(
        blockHeader: BlockHeaderDocument,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<IBlockHeaderBlockDocument>> = {
            height: blockHeader.height,
        };

        await this.updatePartial(criteria, blockHeader, currentSession);
    }

    /**
     * Batch save block headers for IBD (Initial Block Download)
     * Uses bulkWrite with upsert for efficient batch insertion
     * @param headers Array of block headers to save
     * @param currentSession Optional MongoDB session
     */
    public async saveBlockHeadersBatch(
        headers: BlockHeaderDocument[],
        currentSession?: ClientSession,
    ): Promise<void> {
        if (headers.length === 0) {
            return;
        }

        const operations: AnyBulkWriteOperation<IBlockHeaderBlockDocument>[] = headers.map(
            (header) => ({
                updateOne: {
                    filter: { height: header.height },
                    update: { $set: header },
                    upsert: true,
                },
            }),
        );

        const collection = this.getCollection();
        const options: BulkWriteOptions = {
            ordered: false, // Allow parallel execution for better performance
            session: currentSession,
        };

        await collection.bulkWrite(operations, options);
    }

    /**
     * Get block headers in a range for IBD checksum generation
     * @param startHeight Starting block height (inclusive)
     * @param endHeight Ending block height (inclusive)
     */
    public async getBlockHeadersInRange(
        startHeight: bigint,
        endHeight: bigint,
    ): Promise<IBlockHeaderBlockDocument[]> {
        const criteria: Filter<IBlockHeaderBlockDocument> = {
            height: {
                $gte: DataConverter.toDecimal128(startHeight),
                $lte: DataConverter.toDecimal128(endHeight),
            },
        };

        return await this.getAll(criteria, undefined, { height: 1 });
    }

    /**
     * Update checksum data for a block header during IBD
     * @param height Block height
     * @param checksumRoot The checksum root hash
     * @param checksumProofs The checksum proofs
     * @param previousBlockChecksum The previous block's checksum
     */
    public async updateBlockChecksum(
        height: bigint,
        checksumRoot: string,
        checksumProofs: Array<[number, string[]]>,
        previousBlockChecksum: string,
    ): Promise<void> {
        const criteria: Filter<IBlockHeaderBlockDocument> = {
            height: DataConverter.toDecimal128(height),
        };

        await this.updatePartial(criteria, {
            checksumRoot,
            checksumProofs,
            previousBlockChecksum,
        } as Partial<BlockHeaderDocument>);
    }

    /**
     * Batch update block checksums for IBD performance
     * @param updates Array of checksum updates to apply
     */
    public async updateBlockChecksumBatch(
        updates: Array<{
            height: bigint;
            checksumRoot: string;
            checksumProofs: Array<[number, string[]]>;
            previousBlockChecksum: string;
            storageRoot: string;
            receiptRoot: string;
        }>,
    ): Promise<void> {
        if (updates.length === 0) return;

        const operations: AnyBulkWriteOperation<IBlockHeaderBlockDocument>[] = updates.map(
            (update) => ({
                updateOne: {
                    filter: { height: DataConverter.toDecimal128(update.height) },
                    update: {
                        $set: {
                            checksumRoot: update.checksumRoot,
                            checksumProofs: update.checksumProofs,
                            previousBlockChecksum: update.previousBlockChecksum,
                            storageRoot: update.storageRoot,
                            receiptRoot: update.receiptRoot,
                        },
                    },
                },
            }),
        );

        const options: BulkWriteOptions = { ordered: false };
        await this.getCollection().bulkWrite(operations, options);
    }

    /**
     * Get the maximum block height in the database using aggregation
     * More reliable than sorting for large collections
     */
    public async getMaxBlockHeight(): Promise<bigint | null> {
        const result = await this.getCollection()
            .aggregate<{ _id: null; maxHeight: Decimal128 | null }>([
                {
                    $group: {
                        _id: null,
                        maxHeight: { $max: '$height' },
                    },
                },
            ])
            .toArray();

        if (result.length === 0 || !result[0].maxHeight) {
            return null;
        }

        return DataConverter.fromDecimal128(result[0].maxHeight);
    }

    protected override getCollection(): Collection<IBlockHeaderBlockDocument> {
        return this._db.collection('Blocks');
    }
}
