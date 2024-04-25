import { BaseRepository } from '@btc-vision/bsi-common';
import { ClientSession, Collection, Db, Filter } from 'mongodb';
import {
    BlockHeaderBlockDocument,
    IBlockHeaderBlockDocument,
} from '../../blockchain-indexer/processor/block/interfaces/IBlockHeaderBlockDocument.js';
import { BufferHelper } from '../../utils/BufferHelper.js';
import { BlockRootStates } from '../interfaces/BlockRootStates.js';

export class BlockRepository extends BaseRepository<IBlockHeaderBlockDocument> {
    public readonly logColor: string = '#afeeee';

    constructor(db: Db) {
        super(db);
    }

    public async getBlockHeader(
        height: bigint,
        currentSession?: ClientSession,
    ): Promise<IBlockHeaderBlockDocument | undefined> {
        const criteria: Partial<Filter<IBlockHeaderBlockDocument>> = {
            height: BufferHelper.toDecimal128(height),
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
        blockHeader: BlockHeaderBlockDocument,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<IBlockHeaderBlockDocument>> = {
            height: blockHeader.height,
        };

        console.log('Saving block header', blockHeader, criteria);

        await this.updatePartial(criteria, blockHeader, currentSession);
    }

    protected override getCollection(): Collection<IBlockHeaderBlockDocument> {
        return this._db.collection('Blocks');
    }
}
