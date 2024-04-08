import { BaseRepository } from '@btc-vision/motoswapcommon';
import { Collection, Db, Filter } from 'mongodb';
import { IBlockchainInformationDocument } from '../documents/interfaces/IBlockchainInformationDocument.js';
import { BlockchainInformation } from '../models/BlockchainInformation.js';

export class BlockchainInformationRepository extends BaseRepository<IBlockchainInformationDocument> {
    public readonly logColor: string = '#afeeee';

    constructor(db: Db) {
        super(db);
    }

    public async getByNetwork(network: string): Promise<IBlockchainInformationDocument> {
        const criteria: Partial<Filter<IBlockchainInformationDocument>> = {
            network: network,
        };

        const result: IBlockchainInformationDocument | null = await this.queryOne(criteria);

        if (result === null) {
            throw new Error('Error Network type not found');
        }

        return result;
    }

    protected override getCollection(): Collection<IBlockchainInformationDocument> {
        return this._db.collection('BlockchainInformation');
    }
}
