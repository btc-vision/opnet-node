export class FastStringMap<T> implements Map<string, T> {
    private items: Record<string, T>;
    private keyOrder: string[];

    /**
     * Create a new FastStringMap. If another map or array of [key, value] pairs
     * is provided, those entries will be inserted into the new map.
     */
    constructor(iterable?: ReadonlyArray<readonly [string, T]> | null | FastStringMap<T>) {
        this.items = {};
        this.keyOrder = [];

        if (iterable instanceof FastStringMap) {
            this.setAll(iterable);
        } else if (iterable) {
            for (const [key, value] of iterable) {
                this.set(key, value);
            }
        }
    }

    get [Symbol.toStringTag](): string {
        return 'FastStringMap';
    }

    /**
     * Number of entries in the map.
     */
    get size(): number {
        return this.keyOrder.length;
    }

    /**
     * Copies all entries from another FastStringMap into this map,
     * replacing any existing entries.
     */
    public setAll(map: FastStringMap<T>): void {
        this.items = { ...map.items };
        this.keyOrder = [...map.keyOrder];
    }

    /**
     * Inserts or updates the key/value. Returns `this` to allow chaining.
     */
    public set(key: string, value: T): this {
        if (!this.has(key)) {
            this.keyOrder.push(key);
        }
        this.items[key] = value;
        return this;
    }

    /**
     * Retrieves the value for the given key. Returns undefined if key not found.
     */
    public get(key: string): T | undefined {
        return this.items[key];
    }

    /**
     * Checks if a key exists in the map.
     */
    public has(key: string): boolean {
        return Object.prototype.hasOwnProperty.call(this.items, key);
    }

    /**
     * Deletes a key if it exists. Returns boolean indicating success.
     */
    public delete(key: string): boolean {
        if (this.has(key)) {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete this.items[key];
            this.keyOrder = this.keyOrder.filter((k) => k !== key);
            return true;
        }
        return false;
    }

    /**
     * Removes all keys and values.
     */
    public clear(): void {
        this.items = {};
        this.keyOrder = [];
    }

    /**
     * Iterates over [key, value] pairs in insertion order.
     */
    public *entries(): MapIterator<[string, T]> {
        for (const key of this.keyOrder) {
            yield [key, this.items[key]];
        }
    }

    /**
     * Iterates over keys in insertion order.
     */
    public *keys(): MapIterator<string> {
        yield* this.keyOrder;
    }

    /**
     * Iterates over values in insertion order.
     */
    public *values(): MapIterator<T> {
        for (const key of this.keyOrder) {
            yield this.items[key];
        }
    }

    /**
     * forEach callback in insertion order, similar to JS Map.
     */
    public forEach(
        callback: (value: T, key: string, map: FastStringMap<T>) => void,
        thisArg?: unknown,
    ): void {
        for (const key of this.keyOrder) {
            callback.call(thisArg, this.items[key], key, this);
        }
    }

    /**
     * Makes the map iterable with `for...of`, yielding [key, value] pairs.
     */
    public [Symbol.iterator](): MapIterator<[string, T]> {
        return this.entries();
    }
}
