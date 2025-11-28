import { BaseRepository, DataConverter } from '@btc-vision/bsi-common';
import { ClientSession, Collection, Db, Filter } from 'mongodb';
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

    protected override getCollection(): Collection<IBlockHeaderBlockDocument> {
        return this._db.collection('Blocks');
    }
}
