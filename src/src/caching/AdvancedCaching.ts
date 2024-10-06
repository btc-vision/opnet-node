export class AdvancedCaching<K, V extends WeakKey> {
    /**
     * Map to store cache entries with their keys.
     * The values are stored as WeakRefs to allow garbage collection.
     */
    private cache: Map<K, WeakRef<V>> = new Map();

    /**
     * FinalizationRegistry to clean up cache entries when their values are garbage collected.
     */
    private registry: FinalizationRegistry<K>;

    public constructor() {
        this.registry = new FinalizationRegistry((key: K) => {
            console.log(`Removing cache entry for key:`, key);

            this.cache.delete(key);
        });
    }

    /**
     * Adds (caches) a value with the given key.
     * @param key The key associated with the value.
     * @param value The value to cache.
     */
    public set(key: K, value: V): void {
        this.cache.set(key, new WeakRef(value));
        // Register the value with the FinalizationRegistry.
        this.registry.register(value, key);
    }
    
    /**
     * Returns the number of entries in the cache.
     * @returns The number of entries in the cache.
     */
    public size(): number {
        return this.cache.size;
    }

    /**
     * Retrieves the value associated with the given key.
     * @param key The key whose value is to be retrieved.
     * @returns The cached value if found and not garbage collected; otherwise, undefined.
     */
    public get(key: K): V | undefined {
        const ref = this.cache.get(key);
        if (ref) {
            const value = ref.deref();
            if (value !== undefined) {
                return value;
            } else {
                // Value has been garbage collected; remove the entry from the cache.
                this.cache.delete(key);
            }
        }
        return undefined;
    }

    /**
     * Removes all entries from the cache.
     */
    public clear(): void {
        this.cache.clear();
    }
}
