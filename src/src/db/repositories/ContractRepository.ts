import { Collection, Db } from 'mongodb';
import { BaseRepository } from '@btc-vision/motoswapdb';
import { IContractDocument } from '../documents/interfaces/IContractDocument.js';

export class ContractRepository extends BaseRepository<IContractDocument> {
    public moduleName: string = 'ContractRepository';
    public logColor: string = '#afeeee';

    constructor(db: Db) {
        super(db);
    }

    protected override getCollection(): Collection<IContractDocument> {
        return this._db.collection('Contracts');
    }
}
