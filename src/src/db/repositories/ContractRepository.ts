import { BaseRepository } from '@btc-vision/motoswapdb';
import { Collection, Db } from 'mongodb';
import { IContractDocument } from '../documents/interfaces/IContractDocument.js';

export class ContractRepository extends BaseRepository<IContractDocument> {
    public readonly logColor: string = '#afeeee';

    constructor(db: Db) {
        super(db);
    }

    protected override getCollection(): Collection<IContractDocument> {
        return this._db.collection('Internal');
    }
}
