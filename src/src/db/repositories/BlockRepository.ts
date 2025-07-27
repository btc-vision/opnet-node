import { BaseRepository } from '@btc-vision/bsi-common';
import { DataConverter } from '@btc-vision/bsi-db';
import { ClientSession, Collection, Db, Filter } from 'mongodb';
import {
    BlockHeaderDocument,
    IBlockHeaderBlockDocument,
} from '../interfaces/IBlockHeaderBlockDocument.js';
import { ZERO_HASH } from '../../blockchain-indexer/processor/block/types/ZeroValue.js';

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

    /**
     * Get the latest preimage to use.
     * @param blockHeight
     */
    public async getBlockPreimage(blockHeight: bigint): Promise<string> {
        const criteria: Partial<Filter<IBlockHeaderBlockDocument>> = {
            height: DataConverter.toDecimal128(blockHeight - 101n), // we do 101 here just in-case we have a reorg
        };

        const result: IBlockHeaderBlockDocument | null = await this.queryOne(criteria, undefined);
        if (result === null) {
            return ZERO_HASH.replace('0x', '');
        }

        return result.hash;
    }

    /**
     * We do not allow the usage of the last 100 blocks to avoid reorgs
     * @param blockHeight
     */
    public async getBlockPreimages(blockHeight: bigint): Promise<string[]> {
        const criteria: Partial<Filter<IBlockHeaderBlockDocument>> = {
            height: {
                $lte: DataConverter.toDecimal128(blockHeight - 100n),
                $gte: DataConverter.toDecimal128(blockHeight - 150n),
            },
        };

        const result: IBlockHeaderBlockDocument[] = await this.queryMany(criteria, undefined, {
            height: -1,
        });

        return result.map((block) => block.hash);
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

    protected override getCollection(): Collection<IBlockHeaderBlockDocument> {
        return this._db.collection('Blocks');
    }
}
