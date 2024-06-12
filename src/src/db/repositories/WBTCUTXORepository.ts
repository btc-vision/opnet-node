import { BaseRepository } from '@btc-vision/bsi-common';
import { ClientSession, Collection, Db } from 'mongodb';
import { IWBTCUTXODocument } from '../interfaces/IWBTCUTXODocument.js';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';
import { DataConverter } from '@btc-vision/bsi-db';

export class WBTCUTXORepository extends BaseRepository<IWBTCUTXODocument> {
    public readonly logColor: string = '#afeeee';

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

    public async queryBestUTXOs(
        requestedAmount: bigint,
        currentSession?: ClientSession,
    ): Promise<IWBTCUTXODocument[]> {
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
