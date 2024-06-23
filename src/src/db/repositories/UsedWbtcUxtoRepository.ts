import { BaseRepository } from '@btc-vision/bsi-common';
import { ClientSession, Collection, Db, Filter } from 'mongodb';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';
import { IUsedWBTCUTXODocument, UsedUTXOToDelete } from '../interfaces/IWBTCUTXODocument.js';

export class UsedWbtcUxtoRepository extends BaseRepository<IUsedWBTCUTXODocument> {
    private static readonly OLD_UTXO_BLOCK_HEIGHT: bigint = 4n;

    public readonly logColor: string = '#afeeee';

    constructor(db: Db) {
        super(db);
    }

    public async getUsedUtxo(
        hash: string,
        outputIndex: number,
    ): Promise<IUsedWBTCUTXODocument | null> {
        return this.queryOne({ hash, outputIndex });
    }

    public async setUsedUtxo(
        usedUtxo: IUsedWBTCUTXODocument,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Filter<IUsedWBTCUTXODocument> = {
            hash: usedUtxo.hash,
            outputIndex: usedUtxo.outputIndex,
        };

        await this.updatePartial(criteria, usedUtxo, currentSession);
    }

    public async deleteOldUsedUtxos(
        blockHeight: bigint,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<IUsedWBTCUTXODocument>> = {
            blockHeight: { $lt: blockHeight - UsedWbtcUxtoRepository.OLD_UTXO_BLOCK_HEIGHT },
        };

        await this.delete(criteria, currentSession);
    }

    public async deleteUsedUtxos(
        UTXOs: UsedUTXOToDelete[],
        currentSession?: ClientSession,
    ): Promise<void> {
        const bulkWriteOperations = UTXOs.map((utxo) => {
            return {
                deleteMany: {
                    filter: utxo,
                },
            };
        });

        await this.bulkWrite(bulkWriteOperations, currentSession);
    }

    protected override getCollection(): Collection<IUsedWBTCUTXODocument> {
        return this._db.collection(OPNetCollections.USED_WBTC_UTXO);
    }
}
