export class FastStringSet implements Set<string> {
    private items: Record<string, boolean>;
    private keyOrder: string[];

    /**
     * Create a new FastBigIntSet. If another set or array of bigints
     * is provided, those items will be inserted into the new set.
     */
    constructor(iterable?: ReadonlyArray<string> | null | FastStringSet) {
        this.items = {};
        this.keyOrder = [];

        if (iterable instanceof FastStringSet) {
            this.addAll(iterable);
        } else if (iterable) {
            for (const value of iterable) {
                this.add(value);
            }
        }
    }

    get [Symbol.toStringTag](): string {
        return 'FastStringSet';
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
    public add(value: string): this {
        const keyStr = value satisfies string;
        if (!this.has(value)) {
            this.items[keyStr] = true;
            this.keyOrder.push(value);
        }
        return this;
    }

    /**
     * Checks if a value exists in the set.
     */
    public has(value: string): boolean {
        return Object.prototype.hasOwnProperty.call(this.items, value satisfies string);
    }

    /**
     * Removes a value from the set. Returns boolean indicating success.
     */
    public delete(value: string): boolean {
        const keyStr = value satisfies string;
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
     * Copies all values from another FastStringSet into this set,
     * preserving the insertion order from the source.
     */
    public addAll(set: FastStringSet): void {
        for (const value of set.keyOrder) {
            this.add(value);
        }
    }

    /**
     * Iterates over values in insertion order.
     */
    public *values(): SetIterator<string> {
        yield* this.keyOrder;
    }

    /**
     * forEach callback in insertion order, similar to JS Set.
     */
    // @ts-expect-error We dont support these methods here.
    public forEach(
        callback: (value: string, valueAgain: string, set: FastStringSet) => void,
        thisArg?: unknown,
    ): void {
        for (const value of this.keyOrder) {
            callback.call(thisArg, value, value, this);
        }
    }

    /**
     * Makes the set iterable with `for...of`, yielding the values (string).
     */
    public [Symbol.iterator](): SetIterator<string> {
        return this.values();
    }
}
