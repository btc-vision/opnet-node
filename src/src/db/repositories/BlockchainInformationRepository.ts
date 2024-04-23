import { BaseRepository } from '@btc-vision/bsi-common';
import { Collection, Db, Filter } from 'mongodb';
import { IBlockchainInformationDocument } from '../documents/interfaces/IBlockchainInformationDocument.js';

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
            return this.createDefault(network);
        }

        return result;
    }

    public async updateCurrentBlockInProgress(
        network: string,
        blockInProgress: number,
    ): Promise<void> {
        const criteria: Partial<Filter<IBlockchainInformationDocument>> = {
            network: network,
        };

        const document: Partial<IBlockchainInformationDocument> = {
            inProgressBlock: blockInProgress,
        };

        await this.updatePartial(criteria, document);
    }

    protected override getCollection(): Collection<IBlockchainInformationDocument> {
        return this._db.collection('BlockchainInformation');
    }

    private createDefault(network: string): IBlockchainInformationDocument {
        // TODO - Add default values from configs
        return {
            network: network,
            inProgressBlock: 297,
        };
    }
}
