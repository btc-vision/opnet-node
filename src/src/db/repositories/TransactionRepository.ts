import { BaseRepository } from '@btc-vision/bsi-common';
import { ClientSession, Collection, Db, Filter } from 'mongodb';
import { OPNetTransactionTypes } from '../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { ITransactionDocument } from '../interfaces/ITransactionDocument.js';

export class TransactionRepository extends BaseRepository<
    ITransactionDocument<OPNetTransactionTypes>
> {
    public readonly logColor: string = '#afeeee';

    constructor(db: Db) {
        super(db);
    }

    /** Save block headers */
    public async saveTransaction(
        transactionData: ITransactionDocument<OPNetTransactionTypes>,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<ITransactionDocument<OPNetTransactionTypes>>> = {
            hash: transactionData.hash,
            id: transactionData.id,
            blockHeight: transactionData.blockHeight,
        };
        
        await this.updatePartial(criteria, transactionData, currentSession);
    }

    protected override getCollection(): Collection<ITransactionDocument<OPNetTransactionTypes>> {
        return this._db.collection('Transactions');
    }
}
