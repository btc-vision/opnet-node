import {
    BaseRepository,
    DataAccessError,
    DataAccessErrorType,
    DataConverter,
} from '@btc-vision/bsi-common';
import {
    Binary,
    ClientSession,
    Collection,
    Db,
    Decimal128,
    Document,
    Filter,
    FindOptions,
    InsertOneOptions,
    OptionalUnlessRequiredId,
    Sort,
} from 'mongodb';
import { ContractInformation } from '../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { IContractDocument } from '../documents/interfaces/IContractDocument.js';
import { Address } from '@btc-vision/transaction';
import { fromBase64 } from '@btc-vision/bitcoin';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';

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

    public async getContractsDeployedAtHeight(blockHeight: Decimal128): Promise<string[]> {
        const criteria: Filter<Document> = {
            blockHeight: blockHeight,
        };

        const projection = {
            contractPublicKey: 1,
        };

        const collection = this.getCollection();
        const data = await collection.find(criteria, { projection }).toArray();

        const contractAddresses = data.map((doc) => {
            if (typeof doc.contractPublicKey === 'string') {
                return new Address(fromBase64(doc.contractPublicKey));
            } else {
                if (!doc.contractPublicKey) {
                    throw new Error('Contract tweaked public key is undefined');
                }

                return new Address(doc.contractPublicKey.buffer);
            }
        });

        return contractAddresses.map((address) => address.toHex());
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
            if (contractAddress.length !== 132) {
                return Address.fromString(contractAddress);
            } else {
                const contract = await this.getContractFromTweakedHybridPubKey(
                    Binary.createFromHexString(
                        contractAddress.startsWith('0x')
                            ? contractAddress.slice(2)
                            : contractAddress,
                    ),
                    height,
                    currentSession,
                );

                if (contract) {
                    return contract.contractPublicKey;
                } else {
                    return;
                }
            }
        }

        const criteria: Filter<Document> = {
            contractAddress: contractAddress,
        };

        if (height !== undefined) {
            criteria.blockHeight = { $lt: DataConverter.toDecimal128(height) };
        }

        const contract: {
            contractPublicKey: Binary;
        } | null = await this.queryOneAndProject(
            criteria,
            {
                contractPublicKey: 1,
            },
            currentSession,
        );

        if (!contract) {
            return;
        }

        return new Address(contract.contractPublicKey.buffer);
    }

    public async setContract(
        contract: ContractInformation,
        currentSession?: ClientSession,
    ): Promise<void> {
        const contractExists = await this.getContractAddressAt(
            contract.contractAddress,
            undefined,
            currentSession,
        );

        if (contractExists) {
            throw new Error('OP_NET: Contract already exists');
        }

        await this.insert(contract.toDocument(), currentSession);
    }

    public async getContractFromTweakedPubKey(
        contractPublicKey: string,
        height?: bigint,
        currentSession?: ClientSession,
    ): Promise<ContractInformation | undefined> {
        const key = Binary.createFromHexString(
            contractPublicKey.startsWith('0x') ? contractPublicKey.slice(2) : contractPublicKey,
        );
        if ((key.buffer[0] === 0x06 || key.buffer[0] === 0x07) && key.buffer.length === 65) {
            return await this.getContractFromTweakedHybridPubKey(key, height, currentSession);
        }

        const criteria: Filter<Document> = {
            contractPublicKey: key,
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
        return this._db.collection(OPNetCollections.Contracts);
    }

    private async getContractFromTweakedHybridPubKey(
        tweakedHybridPublicKey: Binary,
        height?: bigint,
        currentSession?: ClientSession,
    ): Promise<ContractInformation | undefined> {
        const criteria: Filter<Document> = {
            contractHybridPublicKey: tweakedHybridPublicKey,
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

    private async insert(
        criteria: OptionalUnlessRequiredId<IContractDocument>,
        currentSession?: ClientSession,
    ): Promise<void> {
        try {
            const collection = this.getCollection();
            const options: InsertOneOptions = {
                ...this.getOptions(currentSession),
            };

            const insertedResult = await collection.insertOne(criteria, options);
            if (!insertedResult.acknowledged || !insertedResult.insertedId) {
                throw new Error('OP_NET: Unable to insert contract.');
            }
        } catch {
            throw new Error('OP_NET: Unable to insert contract.');
        }
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
