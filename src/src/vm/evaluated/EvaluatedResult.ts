import { NetEvent } from '@btc-vision/bsi-binary';
import {
    Address,
    MemorySlotData,
    MemorySlotPointer,
} from '@btc-vision/bsi-binary/src/buffer/types/math.js';

export type PointerStorageMap = Map<MemorySlotPointer, MemorySlotData<bigint>>;
export type BlockchainStorageMap = Map<Address, PointerStorageMap>;
export type EvaluatedEvents = Map<Address, NetEvent[]>;

export interface EvaluatedResult {
    readonly changedStorage: BlockchainStorageMap;
    readonly result: Uint8Array | undefined;
    readonly events: EvaluatedEvents | undefined;
    readonly gasUsed: bigint;
}
