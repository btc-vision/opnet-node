import { BaseRepository } from '@btc-vision/bsi-common';
import { AggregateOptions, ClientSession, Collection, Db } from 'mongodb';
import { IWBTCUTXODocument } from '../interfaces/IWBTCUTXODocument.js';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';
import { DataConverter } from '@btc-vision/bsi-db';
import {
    WBTCUTXOAggregation,
    WBTCUTXOAggregationResponse,
} from '../../vm/storage/databases/aggregation/WBTCUTXOSAggregation.js';

export class WBTCUTXORepository extends BaseRepository<IWBTCUTXODocument> {
    public readonly logColor: string = '#afeeee';

    private readonly utxosAggregation: WBTCUTXOAggregation = new WBTCUTXOAggregation();

    constructor(db: Db) {
        super(db);
    }

    public async setWBTCUTXO(
        utxo: IWBTCUTXODocument,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria = {
            hash: utxo.hash,
        };

        await this.updatePartial(criteria, utxo, currentSession);
    }

    public async queryVaultsUTXOs(
        requestedAmount: bigint,
        currentSession?: ClientSession,
    ): Promise<IWBTCUTXODocument[]> {
        const aggregation = this.utxosAggregation.getAggregation();

        const collection = this.getCollection();
        const options: AggregateOptions = this.getOptions(currentSession) as AggregateOptions;
        options.allowDiskUse = true;

        const aggregatedDocument = collection.aggregate<WBTCUTXOAggregationResponse>(
            aggregation,
            options,
        );

        const results: WBTCUTXOAggregationResponse[] = await aggregatedDocument.toArray();
        if (results.length === 0) {
            return [];
        }

        console.log('results', results);

        return [];
    }

    public async deleteWBTCUTXOs(blockId: bigint): Promise<void> {
        const criteria = {
            blockId: {
                $gte: DataConverter.toDecimal128(blockId),
            },
        };

        await this.delete(criteria);
    }

    protected override getCollection(): Collection<IWBTCUTXODocument> {
        return this._db.collection(OPNetCollections.WBTCUTXO);
    }
}
