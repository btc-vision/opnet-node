import { Binary } from 'mongodb';

export interface ISortableTransactionInput {
    readonly originalTransactionId?: Buffer | Binary;
}

export interface ISortableTransaction {
    readonly transactionIdString: string;
    readonly transactionHashString: string;
    readonly inputs: ISortableTransactionInput[];
    readonly priorityFee: bigint;
    readonly computedIndexingHash: Buffer;
}
