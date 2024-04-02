import { Binary, ClientSession, Db } from 'mongodb';
import { IContractPointerValueDocument } from '../documents/interfaces/IContractPointerValueDocument.js';
import { ContractRepository } from './ContractRepository.js';

export class ContractPointerValueRepository extends ContractRepository {
    public readonly logColor: string = '#afeeee';

    constructor(db: Db) {
        super(db);
    }

    public async getByContractAndPointer(
        contractAddress: string,
        pointer: Binary,
        currentSession?: ClientSession,
    ): Promise<IContractPointerValueDocument | null> {
        const criteria: Partial<IContractPointerValueDocument> = {
            contractAddress: contractAddress,
            pointer: pointer,
        };

        return null;
    }
}
