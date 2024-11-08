import { BaseRepository } from '@btc-vision/bsi-common';
import { DataConverter } from '@btc-vision/bsi-db';
import { ClientSession, Collection, Db, Filter } from 'mongodb';
import { BlockRootStates } from '../interfaces/BlockRootStates.js';
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
        currentSession?: ClientSession,
    ): Promise<IBlockHeaderBlockDocument | undefined> {
        const criteria: Partial<BlockHeaderDocument> = {
            hash: hash,
        };

        const result: IBlockHeaderBlockDocument | null = await this.queryOne(
            criteria,
            currentSession,
        );

        if (result === null) {
            return;
        }

        return result;
    }

    public async getBlockHeader(
        height: bigint,
        currentSession?: ClientSession,
    ): Promise<IBlockHeaderBlockDocument | undefined> {
        const criteria: Partial<Filter<IBlockHeaderBlockDocument>> = {
            height: DataConverter.toDecimal128(height),
        };

        const result: IBlockHeaderBlockDocument | null = await this.queryOne(
            criteria,
            currentSession,
        );

        if (result === null) {
            return;
        }

        return result;
    }

    /** Add projection to not fetch the whole document */
    public async getBlockRootStates(
        height: bigint,
        currentSession?: ClientSession,
    ): Promise<BlockRootStates | undefined> {
        const blockHeader = await this.getBlockHeader(height, currentSession);
        if (!blockHeader) {
            return;
        }

        return {
            storageRoot: blockHeader.storageRoot,
            receiptRoot: blockHeader.receiptRoot,
        };
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
