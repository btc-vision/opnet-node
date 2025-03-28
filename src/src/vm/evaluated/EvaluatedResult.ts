import { AddressMap, NetEvent, PointerStorage } from '@btc-vision/transaction';
import { ContractInformation } from '../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { FastBigIntMap } from '../../utils/fast/FastBigintMap.js';
import { FastStringMap } from '../../utils/fast/FastStringMap.js';
import { LoadedStorageList } from '../../api/json-rpc/types/interfaces/results/states/CallResult.js';

export type PointerStorageMap = FastBigIntMap;
export type BlockchainStorageMap = AddressMap<PointerStorageMap>;
export type EvaluatedEvents = AddressMap<NetEvent[]>;

export interface EvaluatedResult {
    readonly changedStorage: BlockchainStorageMap | undefined;
    readonly loadedStorage: AddressMap<PointerStorage>;
    readonly result: Uint8Array | undefined;
    readonly events: EvaluatedEvents | undefined;
    readonly gasUsed: bigint;
    revert?: string;
    readonly deployedContracts: ContractInformation[];
}

export type SafeEvaluatedResult = Omit<
    EvaluatedResult,
    'changedStorage' | 'events' | 'loadedStorage'
> & {
    readonly changedStorage:
        | Map<string, Map<bigint, bigint>>
        | FastStringMap<PointerStorageMap>
        | undefined;

    readonly loadedStorage: LoadedStorageList;
    readonly events: FastStringMap<NetEvent[]> | Map<string, NetEvent[]> | undefined;
};
