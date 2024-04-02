import { ClientSession, Collection, Db } from 'mongodb';
import { BaseRepository } from '@btc-vision/motoswapdb';
import { IContractPointerValueDocument } from '../documents/interfaces/IContractPointerValueDocument.js';
import { Binary } from 'mongodb';

export class ContractPointerValueRepository {
    public moduleName: string = 'ContractKeyPointerRepository';
    public logColor: string = '#afeeee';

    constructor(db: Db) {
        
    }

    public async getByContractAndPointer(
        contractAddress: string,
        pointer: Binary,
        currentSession?: ClientSession
    ): Promise<IContractPointerValueDocument | null> {
        const criteria: Partial<IContractPointerValueDocument> = {
            contractAddress: contractAddress,
            pointer: pointer
        };

        return null;
    }
}
