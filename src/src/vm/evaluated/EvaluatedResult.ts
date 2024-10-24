import { AddressMap, MemorySlotData, MemorySlotPointer, NetEvent } from '@btc-vision/transaction';
import { ContractInformation } from '../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';

export type PointerStorageMap = Map<MemorySlotPointer, MemorySlotData<bigint>>;
export type BlockchainStorageMap = AddressMap<PointerStorageMap>;
export type EvaluatedEvents = AddressMap<NetEvent[]>;

export interface EvaluatedResult {
    readonly changedStorage: BlockchainStorageMap | undefined;
    readonly result: Uint8Array | undefined;
    readonly events: EvaluatedEvents | undefined;
    readonly gasUsed: bigint;
    revert?: string;
    readonly deployedContracts: ContractInformation[];
}
