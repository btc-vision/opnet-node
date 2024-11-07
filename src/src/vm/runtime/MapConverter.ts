import { AddressMap, PointerStorage } from '@btc-vision/transaction';
import { BlockchainStorageMap, PointerStorageMap } from '../evaluated/EvaluatedResult.js';

export class MapConverter {
    public static convertDeterministicBlockchainStorageMapToBlockchainStorage(
        storage: AddressMap<PointerStorage>,
    ): BlockchainStorageMap {
        const result = new AddressMap<PointerStorageMap>();

        for (const [key, value] of storage) {
            const subPointerStorage: PointerStorageMap = new Map();
            for (const [k, v] of value) {
                subPointerStorage.set(k, v);
            }

            result.set(key, subPointerStorage);
        }

        return result;
    }
}
