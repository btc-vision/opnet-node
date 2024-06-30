import { Address } from '@btc-vision/bsi-binary';
import { ContractInformation } from '../../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';

export interface InternalContractCallParameters {
    readonly contractAddress: Address;
    readonly from: Address;
    readonly callee: Address;

    readonly maxGas: bigint;

    readonly calldata: Buffer;
    readonly externalCall: boolean;

    readonly transactionId: string | null; // external call have this empty
    readonly transactionHash: string | null; // external call have this empty

    readonly blockHeight: bigint;
    readonly blockMedian: bigint;

    readonly contractDeployDepth: number;
    readonly callDepth: number;

    readonly gasUsed: bigint;
    allowCached?: boolean;

    readonly deployedContracts?: ContractInformation[];
    readonly callStack?: Address[];
}

export interface ExecutionParameters {
    readonly contractAddress: Address;
    readonly isView: boolean;
    readonly abi: number;
    readonly calldata: Uint8Array;

    readonly caller: Address;
    readonly callee: Address;

    readonly transactionId: string | null; // external call have this empty
    readonly transactionHash: string | null; // external call have this empty

    readonly blockNumber: bigint;
    readonly blockMedian: bigint;

    readonly maxGas: bigint;
    readonly gasUsed: bigint;

    // Depth
    readonly contractDeployDepth: number;
    readonly callDepth: number;

    readonly externalCall: boolean;
    readonly callStack: Address[];
}

export interface IEvaluationParameters extends ExecutionParameters {
    readonly canWrite: boolean;
}
