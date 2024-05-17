import { IndexDescription } from 'mongodb';

export enum OPNetCollections {
    Blocks = 'Blocks',
    Transactions = 'Transactions',
    BlockWitnesses = 'BlockWitnesses',
    Contracts = 'Contracts',
    InternalPointers = 'InternalPointers',
    BlockchainInformation = 'BlockchainInformation',
    Reorgs = 'Reorgs',
}

export abstract class IndexedCollection<T extends OPNetCollections> {
    protected constructor(public readonly collection: T) {}

    public abstract getIndexes(): IndexDescription[];
}
