import { Address, AddressMap, PointerStorage } from '@btc-vision/transaction';
import { ContractInformation } from '../../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { StrippedTransactionInput } from '../../../blockchain-indexer/processor/transaction/inputs/TransactionInput.js';
import { StrippedTransactionOutput } from '../../../blockchain-indexer/processor/transaction/inputs/TransactionOutput.js';

export interface InternalContractCallParameters {
    contractAddress: Address;

    readonly contractAddressStr: string;

    readonly from: Address;
    readonly txOrigin: Address;
    readonly msgSender?: Address;

    readonly maxGas: bigint;

    readonly calldata: Buffer;
    readonly externalCall: boolean;

    readonly transactionId: Buffer | null; // external call have this empty
    readonly transactionHash: Buffer | null; // external call have this empty

    readonly blockHeight: bigint;
    readonly blockMedian: bigint;
    readonly safeU64: bigint;

    readonly contractDeployDepth: number;
    readonly callDepth: number;

    readonly gasUsed: bigint;
    allowCached?: boolean;

    readonly storage: AddressMap<PointerStorage>;

    readonly deployedContracts?: ContractInformation[];
    readonly callStack?: Address[];

    readonly inputs: StrippedTransactionInput[];
    readonly outputs: StrippedTransactionOutput[];

    readonly serializedInputs: Uint8Array | undefined;
    readonly serializedOutputs: Uint8Array | undefined;
}

export interface ExecutionParameters {
    readonly contractAddress: Address;
    readonly contractAddressStr: string;

    readonly calldata: Uint8Array;

    readonly txOrigin: Address;
    readonly msgSender: Address;

    readonly transactionId: Buffer | null; // external call have this empty
    readonly transactionHash: Buffer | null; // external call have this empty

    readonly blockNumber: bigint;
    readonly blockMedian: bigint;
    readonly safeU64: bigint;

    readonly maxGas: bigint;
    readonly gasUsed: bigint;

    // Depth
    readonly contractDeployDepth: number;
    readonly callDepth: number;

    readonly externalCall: boolean;
    readonly callStack: Address[];

    readonly storage: AddressMap<PointerStorage>;
    readonly deployedContracts?: ContractInformation[];

    readonly isConstructor: boolean;

    readonly inputs: StrippedTransactionInput[];
    readonly outputs: StrippedTransactionOutput[];

    readonly serializedInputs: Uint8Array | undefined;
    readonly serializedOutputs: Uint8Array | undefined;
}
