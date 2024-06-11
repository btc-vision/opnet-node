import { BaseRepository } from '@btc-vision/bsi-common';
import { Collection, Db } from 'mongodb';
import { IWBTCUTXODocument } from '../interfaces/IWBTCUTXODocument.js';

export class WBTCUTXORepository extends BaseRepository<IWBTCUTXODocument> {
    public readonly logColor: string = '#afeeee';

    constructor(db: Db) {
        super(db);
    }

    /*public async getReorgs(
        fromBlock: bigint = 0n,
        toBlock: bigint = 0n,
    ): Promise<IReorgDocument[] | undefined> {
        const criteria: Filter<IReorgDocument> = {
            fromBlock: { $gte: DataConverter.toDecimal128(fromBlock) },
        };

        if (toBlock > 0n) criteria.toBlock = { $lte: DataConverter.toDecimal128(toBlock) };

        const reorgs = await this.queryMany(criteria);
        if (!reorgs) {
            return;
        }

        return reorgs;
    }

    public async deleteReorgs(fromBlock: bigint): Promise<void> {
        const filter: Filter<IReorgDocument> = {
            fromBlock: DataConverter.toDecimal128(fromBlock),
        };

        await this.delete(filter);
    }

    public async setReorg(reorgData: IReorgData): Promise<void> {
        const reorg: IReorgDocument = {
            fromBlock: DataConverter.toDecimal128(reorgData.fromBlock),
            toBlock: DataConverter.toDecimal128(reorgData.toBlock),
            timestamp: reorgData.timestamp,
        };

        const filter = { fromBlock: reorg.fromBlock, toBlock: reorg.toBlock };

        await this.updatePartial(filter, reorg);
    }*/

    protected override getCollection(): Collection<IWBTCUTXODocument> {
        return this._db.collection('WBTCUTXO');
    }
}
