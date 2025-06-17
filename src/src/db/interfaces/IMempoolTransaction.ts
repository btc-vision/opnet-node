import { Binary, Decimal128, Long } from 'mongodb';

export interface IMempoolTransaction {
    id: string;

    readonly data: Binary;

    readonly psbt: boolean;
    readonly previousPsbtId?: string | null;

    readonly blockHeight: Decimal128;
    readonly theoreticalGasLimit: Long;
    readonly priorityFee: Long;
    readonly firstSeen: Date | undefined;

    readonly isOPNet: boolean;

    readonly inputs: {
        readonly transactionId: string;
        readonly outputIndex: number;
    }[];

    readonly outputs: {
        readonly data: Binary;
        readonly address: string | null;
        readonly outputIndex: number;
        value: Long | number;
    }[];
}

export interface IMempoolTransactionObj
    extends Omit<
        IMempoolTransaction,
        'data' | 'blockHeight' | 'outputs' | 'inputs' | 'theoreticalGasLimit' | 'priorityFee'
    > {
    readonly data: Buffer;
    readonly blockHeight: bigint;

    isOPNet: boolean;
    theoreticalGasLimit: bigint;
    priorityFee: bigint;

    readonly inputs: {
        readonly transactionId: string;
        readonly outputIndex: number;
    }[];

    readonly outputs: {
        readonly data: Buffer;
        readonly address: string | null;
        readonly outputIndex: number;
        value: Long;
    }[];
}
