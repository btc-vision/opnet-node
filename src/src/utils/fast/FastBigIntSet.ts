export class FastBigIntSet implements Set<bigint> {
    private items: Record<string, boolean>;
    private keyOrder: bigint[];

    /**
     * Create a new FastBigIntSet. If another set or array of bigints
     * is provided, those items will be inserted into the new set.
     */
    constructor(iterable?: ReadonlyArray<bigint> | null | FastBigIntSet) {
        this.items = {};
        this.keyOrder = [];

        if (iterable instanceof FastBigIntSet) {
            this.addAll(iterable);
        } else if (iterable) {
            for (const value of iterable) {
                this.add(value);
            }
        }
    }

    get [Symbol.toStringTag](): string {
        return 'FastBigIntSet';
    }

    /**
     * Number of entries in the set.
     */
    get size(): number {
        return this.keyOrder.length;
    }

    /**
     * Inserts a value into the set. Returns `this` to allow chaining.
     */
    public add(value: bigint): this {
        const keyStr = value.toString();
        if (!this.has(value)) {
            this.items[keyStr] = true;
            this.keyOrder.push(value);
        }
        return this;
    }

    /**
     * Checks if a value exists in the set.
     */
    public has(value: bigint): boolean {
        return Object.prototype.hasOwnProperty.call(this.items, value.toString());
    }

    /**
     * Removes a value from the set. Returns boolean indicating success.
     */
    public delete(value: bigint): boolean {
        const keyStr = value.toString();
        if (this.has(value)) {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete this.items[keyStr];
            this.keyOrder = this.keyOrder.filter((k) => k !== value);
            return true;
        }
        return false;
    }

    /**
     * Removes all values.
     */
    public clear(): void {
        this.items = {};
        this.keyOrder = [];
    }

    /**
     * Copies all values from another FastBigIntSet into this set,
     * preserving the insertion order from the source.
     */
    public addAll(set: FastBigIntSet): void {
        for (const value of set.keyOrder) {
            this.add(value);
        }
    }

    /**
     * Iterates over values in insertion order.
     */
    public *values(): SetIterator<bigint> {
        yield* this.keyOrder;
    }

    /**
     * forEach callback in insertion order, similar to JS Set.
     */
    // @ts-expect-error We dont support these methods here.
    public forEach(
        callback: (value: bigint, valueAgain: bigint, set: FastBigIntSet) => void,
        thisArg?: unknown,
    ): void {
        for (const value of this.keyOrder) {
            callback.call(thisArg, value, value, this);
        }
    }

    /**
     * Makes the set iterable with `for...of`, yielding the values (bigints).
     */
    public [Symbol.iterator](): SetIterator<bigint> {
        return this.values();
    }
}
