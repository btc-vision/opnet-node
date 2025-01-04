import { AddressMap, NetEvent } from '@btc-vision/transaction';
import { ContractInformation } from '../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { FastBigIntMap } from '../../utils/fast/FastBigintMap.js';
import { FastStringMap } from '../../utils/fast/FastStringMap.js';

export type PointerStorageMap = FastBigIntMap;
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

export type SafeEvaluatedResult = Omit<EvaluatedResult, 'changedStorage' | 'events'> & {
    readonly changedStorage: FastStringMap<PointerStorageMap> | undefined;
    readonly events: FastStringMap<NetEvent[]> | undefined;
};
