import { Address, AddressMap, PointerStorage } from '@btc-vision/transaction';
import { ContractInformation } from '../../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { StrippedTransactionInput } from '../../../blockchain-indexer/processor/transaction/inputs/TransactionInput.js';
import { StrippedTransactionOutput } from '../../../blockchain-indexer/processor/transaction/inputs/TransactionOutput.js';
import { AccessList } from '../../../api/json-rpc/types/interfaces/results/states/CallResult.js';
import { AddressStack } from '../classes/AddressStack.js';
import { GasTracker } from '../GasTracker.js';
import { SpecialContract } from '../../../poc/configurations/types/SpecialContracts.js';
import { MutableNumber } from '../../mutables/MutableNumber.js';

export interface InternalContractCallParameters {
    contractAddress: Address;

    readonly contractAddressStr: string;

    readonly from: Address;
    readonly txOrigin: Address;
    readonly msgSender?: Address;

    readonly memoryPagesUsed?: bigint;
    readonly mldsaLoadCounter: MutableNumber;
    readonly gasTracker: GasTracker;

    readonly calldata: Uint8Array;
    readonly externalCall: boolean;

    readonly transactionId: Uint8Array;
    readonly transactionHash: Uint8Array;
    readonly blockHash: Uint8Array;

    readonly blockHeight: bigint;
    readonly blockMedian: bigint;

    readonly contractDeployDepth: MutableNumber | undefined;
    readonly contractUpdateDepth: MutableNumber | undefined;

    readonly callStack: AddressStack | undefined;
    allowCached?: boolean;

    readonly storage: AddressMap<PointerStorage>;
    readonly preloadStorage: AddressMap<PointerStorage>;

    readonly deployedContracts?: AddressMap<ContractInformation>;
    readonly touchedAddresses?: AddressMap<boolean>;

    readonly inputs: StrippedTransactionInput[];
    readonly outputs: StrippedTransactionOutput[];

    readonly serializedInputs: Uint8Array | undefined;
    readonly serializedOutputs: Uint8Array | undefined;

    readonly isDeployment: boolean;
    readonly isUpdate: boolean;

    readonly accessList?: AccessList;
    readonly preloadStorageList?: AddressMap<Uint8Array[]>;
    readonly specialContract: SpecialContract | undefined;
}

export interface ExecutionParameters {
    readonly contractAddress: Address;
    readonly contractAddressStr: string;

    readonly calldata: Uint8Array;

    readonly txOrigin: Address;
    readonly msgSender: Address;

    readonly transactionId: Uint8Array;
    readonly transactionHash: Uint8Array;
    readonly blockHash: Uint8Array;

    readonly blockNumber: bigint;
    readonly blockMedian: bigint;

    readonly gasTracker: GasTracker;

    readonly contractDeployDepth: MutableNumber | undefined;
    readonly contractUpdateDepth: MutableNumber | undefined;
    readonly externalCall: boolean;

    readonly storage: AddressMap<PointerStorage>;
    readonly preloadStorage: AddressMap<PointerStorage>;
    readonly deployedContracts: AddressMap<ContractInformation> | undefined;

    readonly touchedAddresses: AddressMap<boolean> | undefined;
    readonly callStack: AddressStack | undefined;

    readonly memoryPagesUsed: bigint | undefined;
    readonly mldsaLoadCounter: MutableNumber;

    readonly isDeployment: boolean;
    readonly isUpdate: boolean;

    readonly inputs: StrippedTransactionInput[];
    readonly outputs: StrippedTransactionOutput[];

    readonly serializedInputs: Uint8Array | undefined;
    readonly serializedOutputs: Uint8Array | undefined;

    readonly accessList?: AccessList;
    readonly preloadStorageList?: AddressMap<Uint8Array[]>;
    readonly specialContract: SpecialContract | undefined;
}
