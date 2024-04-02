import { ClientSession, Collection, Db } from 'mongodb';
import { BaseRepository } from '@btc-vision/motoswapdb';
import { IContractKeyPointerDocument } from '../documents/interfaces/IContractKeyPointerDocument.js';

export class ContractKeyPointerRepository extends BaseRepository<IContractKeyPointerDocument> {
    public moduleName: string = 'ContractKeyPointerRepository';
    public logColor: string = '#afeeee';

    constructor(db: Db) {
        super(db);
    }

    public async getByContractAndKey(contractAddress: string,
        key: string,
        currentSession?: ClientSession): Promise<IContractKeyPointerDocument | null> {
        const criteria: Partial<IContractKeyPointerDocument> = {
            contractAddress: contractAddress,
            key: key
        };

        const document = this.queryOne(criteria,
            currentSession);

        return document;
    }

    protected override getCollection(): Collection<IContractKeyPointerDocument> {
        return this._db.collection('ContractKeyPointers');
    }
}
