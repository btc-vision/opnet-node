export class FastBigIntMap implements Map<bigint, bigint> {
    private items: Record<string, bigint>;
    private keyOrder: bigint[];

    constructor(iterable?: ReadonlyArray<readonly [bigint, bigint]> | null | FastBigIntMap) {
        this.items = {};
        this.keyOrder = [];

        if (iterable instanceof FastBigIntMap) {
            this.setAll(iterable);
        } else {
            if (iterable) {
                for (const [key, value] of iterable) {
                    this.set(key, value);
                }
            }
        }
    }

    get [Symbol.toStringTag](): string {
        return 'FastBigIntMap';
    }

    /**
     * Number of entries in the map.
     */
    get size(): number {
        return this.keyOrder.length;
    }

    public setAll(map: FastBigIntMap): void {
        this.items = { ...map.items };
        this.keyOrder = [...map.keyOrder];
    }

    /**
     * Inserts or updates the key/value. Returns `this` to allow chaining.
     */
    set(key: bigint, value: bigint): this {
        const keyStr = key.toString();
        // If key is new, push to keyOrder
        if (!this.has(key)) {
            this.keyOrder.push(key);
        }
        // Store value in the record
        this.items[keyStr] = value;
        return this;
    }

    /**
     * Retrieves the value for the given key. Returns undefined if key not found.
     */
    get(key: bigint): bigint | undefined {
        return this.items[key.toString()];
    }

    /**
     * Checks if a key exists in the map.
     */
    has(key: bigint): boolean {
        return Object.prototype.hasOwnProperty.call(this.items, key.toString());
    }

    /**
     * Deletes a key if it exists. Returns boolean indicating success.
     */
    delete(key: bigint): boolean {
        const keyStr = key.toString();
        if (this.has(key)) {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete this.items[keyStr];
            // Remove from keyOrder
            this.keyOrder = this.keyOrder.filter((k) => k !== key);
            return true;
        }
        return false;
    }

    /**
     * Removes all keys and values.
     */
    clear(): void {
        this.items = {};
        this.keyOrder = [];
    }

    /**
     * Iterates over [key, value] pairs in insertion order.
     */
    *entries(): MapIterator<[bigint, bigint]> {
        for (const key of this.keyOrder) {
            yield [key, this.items[key.toString()]];
        }
    }

    /**
     * Iterates over keys in insertion order.
     */
    *keys(): MapIterator<bigint> {
        yield* this.keyOrder;
    }

    /**
     * Iterates over values in insertion order.
     */
    *values(): MapIterator<bigint> {
        for (const key of this.keyOrder) {
            yield this.items[key.toString()];
        }
    }

    /**
     * forEach callback in insertion order, similar to JS Map.
     */
    forEach(
        callback: (value: bigint, key: bigint, map: FastBigIntMap) => void,
        thisArg?: unknown,
    ): void {
        for (const key of this.keyOrder) {
            callback.call(thisArg, this.items[key.toString()], key, this);
        }
    }

    /**
     * Makes the map iterable with `for...of`, yielding [key, value] pairs.
     */
    [Symbol.iterator](): MapIterator<[bigint, bigint]> {
        return this.entries();
    }
}
