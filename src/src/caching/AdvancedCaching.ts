/**
 * Automatically cleans up cache entries when their values are garbage collected.
 * Great for caching promises that might be repetitive and require a lot of computation.
 */
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

    public delete(key: K): boolean {
        const deleted = this.cache.delete(key);
        if (deleted) {
            // If the key was found and deleted, unregister it from the FinalizationRegistry.
            const ref = this.cache.get(key);
            if (ref) {
                this.registry.unregister(<object | symbol>ref.deref());
            }
        }
        return deleted;
    }

    public entries(): IterableIterator<[K, V]> {
        const entries: [K, V][] = [];
        for (const [key, weakRef] of this.cache.entries()) {
            const value = weakRef.deref();
            if (value !== undefined) {
                entries.push([key, value]);
            } else {
                // Value has been garbage collected; remove the entry from the cache.
                this.cache.delete(key);
            }
        }
        return entries[Symbol.iterator]();
    }

    /**
     * Removes all entries from the cache.
     */
    public clear(): void {
        this.cache.clear();
    }
}
