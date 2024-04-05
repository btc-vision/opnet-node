export interface TransactionOutputSetInfo {
    height: number;
    bestblock: string;
    transactions: number;
    txouts: number;
    bogosize: number;
    hash_serialized_2?: string;
    disk_size: number;
    total_amount: number;
}
