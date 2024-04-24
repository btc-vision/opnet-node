import { BaseRepository } from '@btc-vision/bsi-common';
import { ClientSession, Collection, Db, Filter, FindOptions } from 'mongodb';
import { ContractInformation } from '../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { IContractDocument } from '../documents/interfaces/IContractDocument.js';

export class ContractRepository extends BaseRepository<IContractDocument> {
    public readonly logColor: string = '#afeeee';

    constructor(db: Db) {
        super(db);
    }

    public async hasContract(
        contractAddress: string,
        currentSession?: ClientSession | undefined,
    ): Promise<boolean> {
        const collection = this.getCollection();
        const options: FindOptions = this.getOptions(currentSession);

        const hasContract: number = await collection.countDocuments({ contractAddress }, options);
        return hasContract > 0;
    }

    public async getContract(
        contractAddress: string,
        currentSession?: ClientSession | undefined,
    ): Promise<ContractInformation | null> {
        const contract = await this.queryOne({ contractAddress }, currentSession);
        if (!contract) {
            return null;
        }

        return ContractInformation.fromDocument(contract);
    }

    public async setContract(
        contract: ContractInformation,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<IContractDocument>> = {
            contractAddress: contract.contractAddress,
        };

        await this.updatePartial(criteria, contract.toDocument(), currentSession);
    }

    public async getContractAtVirtualAddress(
        virtualAddress: string,
        currentSession?: ClientSession | undefined,
    ): Promise<ContractInformation | null> {
        const contract = await this.queryOne({ virtualAddress }, currentSession);
        if (!contract) {
            return null;
        }

        return ContractInformation.fromDocument(contract);
    }

    protected override getCollection(): Collection<IContractDocument> {
        return this._db.collection('Internal');
    }
}
