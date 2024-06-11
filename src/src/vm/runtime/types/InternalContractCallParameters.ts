import { Address } from '@btc-vision/bsi-binary';

export interface InternalContractCallParameters {
    readonly contractAddress: Address;
    readonly from: Address;
    readonly callee: Address;

    readonly maxGas: bigint;

    readonly calldata: Buffer;
    readonly externalCall: boolean;

    readonly transactionId?: string; // external call have this empty

    readonly blockHeight?: bigint;
    readonly gasUsed?: bigint;
    allowCached?: boolean;
}

export interface ExecutionParameters {
    readonly contractAddress: Address;
    readonly isView: boolean;
    readonly abi: number;
    readonly calldata: Uint8Array;

    readonly caller: Address;
    readonly callee: Address;

    readonly externalCall: boolean;
}

export interface IEvaluationParameters extends ExecutionParameters {
    readonly canWrite: boolean;
}
