import { IndexDescription } from 'mongodb';

export enum OPNetCollections {
    Blocks = 'Blocks',
    Transactions = 'Transactions',
    UnspentTransactions = 'UnspentTransactions',
    AnyoneCanSpend = 'AnyoneCanSpend',
    BlockWitnesses = 'BlockWitnesses',
    Contracts = 'Contracts',
    InternalPointers = 'InternalPointers',
    BlockchainInformation = 'BlockchainInformation',
    Reorgs = 'Reorgs',
    Mempool = 'Mempool',
    PublicKeys = 'PublicKeys',
    Epochs = 'Epochs',
    EpochSubmissions = 'EpochSubmissions',
    TargetEpochs = 'TargetEpochs',
    MLDSAPublicKeys = 'MLDSAPublicKeys',
}

export abstract class IndexedCollection<T extends OPNetCollections> {
    protected constructor(public readonly collection: T) {}

    public abstract getIndexes(): IndexDescription[];
}
