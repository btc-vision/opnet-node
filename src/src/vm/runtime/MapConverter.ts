import { Address, BlockchainStorage, DeterministicMap } from '@btc-vision/bsi-binary';
import { BlockchainStorageMap, PointerStorageMap } from '../evaluated/EvaluatedResult.js';

export class MapConverter {
    public static deterministicMapToMap<K, V>(d: DeterministicMap<K, V>): Map<K, V> {
        const map = new Map<K, V>();
        for (const [key, value] of d) {
            map.set(key, value);
        }

        return map;
    }

    public static convertDeterministicBlockchainStorageMapToBlockchainStorage(
        storage: BlockchainStorage,
    ): BlockchainStorageMap {
        const result = new Map<Address, PointerStorageMap>();
        for (const [key, value] of storage) {
            const subPointerStorage = new Map();
            for (const [k, v] of value) {
                subPointerStorage.set(k, v);
            }
            result.set(key, subPointerStorage);
        }
        return result;
    }
}