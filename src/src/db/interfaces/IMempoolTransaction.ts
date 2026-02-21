import { Binary, Decimal128, Long } from 'mongodb';
import { OPNetTransactionTypes } from '../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';

export interface IMempoolTransaction {
    id: string;

    readonly data: Binary;

    readonly psbt: boolean;
    readonly previousPsbtId?: string | null;

    readonly blockHeight: Decimal128;
    readonly firstSeen: Date | undefined;

    readonly transactionType: string;

    // OPNet-specific fields (present only for OPNet transactions)
    readonly theoreticalGasLimit?: Long;
    readonly priorityFee?: Long;
    readonly from?: string;
    readonly contractAddress?: string;
    readonly calldata?: string;
    readonly bytecode?: string;

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

export interface IMempoolTransactionObj {
    id: string;

    readonly data: Uint8Array;
    readonly psbt: boolean;
    readonly previousPsbtId?: string | null;

    readonly blockHeight: bigint;
    readonly firstSeen: Date | undefined;

    transactionType: OPNetTransactionTypes;

    // OPNet-specific fields (optional on base, required on OPNet subtypes)
    theoreticalGasLimit?: bigint;
    priorityFee?: bigint;
    from?: string;
    contractAddress?: string;
    calldata?: string;
    bytecode?: string;

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

export interface IMempoolOPNetTransactionObj extends IMempoolTransactionObj {
    theoreticalGasLimit: bigint;
    priorityFee: bigint;
    from: string;
    contractAddress: string;
    calldata: string;
}

export interface IMempoolInteractionTransactionObj extends IMempoolOPNetTransactionObj {}

export interface IMempoolDeploymentTransactionObj extends IMempoolOPNetTransactionObj {
    bytecode: string;
}

export type AnyMempoolTransactionObj =
    | IMempoolTransactionObj
    | IMempoolInteractionTransactionObj
    | IMempoolDeploymentTransactionObj;
