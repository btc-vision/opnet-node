import { IndexDescription } from 'mongodb';

export enum OPNetCollections {
    Blocks = 'Blocks',
    Transactions = 'Transactions',
    UnspentTransactions = 'UnspentTransactions',
    BlockWitnesses = 'BlockWitnesses',
    Contracts = 'Contracts',
    InternalPointers = 'InternalPointers',
    BlockchainInformation = 'BlockchainInformation',
    Reorgs = 'Reorgs',
    Mempool = 'Mempool',
    WBTCUTXO = 'WBTCUTXO',
    PENDING_WBTC_UTXO = 'PENDING_WBTC_UTXO',
    USED_WBTC_UTXO = 'USED_WBTC_UTXO',
    Vaults = 'Vaults',
    CompromisedTransactions = 'CompromisedTransactions',
    PublicKeys = 'PublicKeys',
}

export abstract class IndexedCollection<T extends OPNetCollections> {
    protected constructor(public readonly collection: T) {}

    public abstract getIndexes(): IndexDescription[];
}
