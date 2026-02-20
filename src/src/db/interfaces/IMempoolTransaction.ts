import { Binary, Decimal128, Long } from 'mongodb';
import { OPNetTransactionTypes } from '../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { Address } from '@btc-vision/transaction';

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

export interface IMempoolTransactionObj extends Omit<
    IMempoolTransaction,
    'data' | 'blockHeight' | 'outputs' | 'inputs' | 'theoreticalGasLimit' | 'priorityFee'
> {
    readonly data: Uint8Array;
    readonly blockHeight: bigint;

    transactionType: OPNetTransactionTypes;
    theoreticalGasLimit: bigint;
    priorityFee: bigint;

    from?: Address;

    readonly inputs: {
        readonly transactionId: string;
        readonly outputIndex: number;
    }[];

    readonly outputs: {
        readonly data: Uint8Array;
        readonly address: string | null;
        readonly outputIndex: number;
        value: Long;
    }[];
}
