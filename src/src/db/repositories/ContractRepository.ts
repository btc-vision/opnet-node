import { BaseRepository, DataAccessError, DataAccessErrorType } from '@btc-vision/bsi-common';
import { DataConverter } from '@btc-vision/bsi-db';
import {
    Binary,
    ClientSession,
    Collection,
    Db,
    Document,
    Filter,
    FindOptions,
    Sort,
} from 'mongodb';
import { ContractInformation } from '../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { IContractDocument } from '../documents/interfaces/IContractDocument.js';
import { Address } from '@btc-vision/transaction';

export class ContractRepository extends BaseRepository<IContractDocument> {
    public readonly logColor: string = '#afeeee';

    public constructor(db: Db) {
        super(db);
    }

    public async deleteContractsFromBlockHeight(
        blockHeight: bigint,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<IContractDocument>> = {
            blockHeight: { $gte: DataConverter.toDecimal128(blockHeight) },
        };

        await this.delete(criteria, currentSession);
    }

    public async getContract(
        contractAddress: string,
        height?: bigint,
        currentSession?: ClientSession,
    ): Promise<ContractInformation | undefined> {
        if (contractAddress.startsWith('0x')) {
            return await this.getContractFromTweakedPubKey(contractAddress, height, currentSession);
        }

        const criteria: Filter<Document> = { contractAddress: contractAddress };
        if (height !== undefined) {
            criteria.blockHeight = { $lte: DataConverter.toDecimal128(height) };
        }

        const contract = await this.queryOne(criteria, currentSession);
        if (!contract) {
            return;
        }

        return ContractInformation.fromDocument(contract);
    }

    public async getContractAddressAt(
        contractAddress: string,
        height?: bigint,
        currentSession?: ClientSession,
    ): Promise<Address | undefined> {
        if (contractAddress.startsWith('0x')) {
            return Address.fromString(contractAddress);
        }

        const criteria: Filter<Document> = {
            contractAddress: contractAddress,
        };

        if (height !== undefined) {
            criteria.blockHeight = { $lt: DataConverter.toDecimal128(height) };
        }

        const contract: {
            contractTweakedPublicKey: Binary;
        } | null = await this.queryOneAndProject(
            criteria,
            {
                contractTweakedPublicKey: 1,
            },
            currentSession,
        );

        if (!contract) {
            return;
        }

        return new Address(contract.contractTweakedPublicKey.buffer);
    }

    // TODO: Add verification to make sure the contract it tries to deploy does not already exist.
    public async setContract(
        contract: ContractInformation,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria: Partial<Filter<IContractDocument>> = {
            contractAddress: contract.contractAddress,
        };

        await this.updatePartial(criteria, contract.toDocument(), currentSession);
    }

    public async getContractFromTweakedPubKey(
        contractTweakedPublicKey: string,
        height?: bigint,
        currentSession?: ClientSession,
    ): Promise<ContractInformation | undefined> {
        const criteria: Filter<Document> = {
            contractTweakedPublicKey: Binary.createFromHexString(
                contractTweakedPublicKey.replace('0x', ''),
            ),
        };

        if (height !== undefined) {
            criteria.blockHeight = { $lte: DataConverter.toDecimal128(height) };
        }

        const contract = await this.queryOne(criteria, currentSession);
        if (!contract) {
            return;
        }

        return ContractInformation.fromDocument(contract);
    }

    protected override getCollection(): Collection<IContractDocument> {
        return this._db.collection('Contracts');
    }

    private async queryOneAndProject<TDocument>(
        criteria: Filter<Document>,
        projection: Document,
        currentSession?: ClientSession,
        sort?: Sort,
    ): Promise<TDocument | null> {
        try {
            const collection = this.getCollection();
            const options: FindOptions = this.getOptions(currentSession);

            options.sort = sort;
            options.projection = projection;

            return (await collection.findOne(criteria, options)) as TDocument;
        } catch (error) {
            if (error instanceof Error) {
                const errorDescription: string = error.stack || error.message;

                throw new DataAccessError(errorDescription, DataAccessErrorType.Unknown, '');
            } else {
                throw error;
            }
        }
    }
}
