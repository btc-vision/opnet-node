declare global {
    interface PromiseConstructor {
        /**
         * If you pass in a fixed-length tuple (e.g., `[p1, p2, p3]`), you get back
         * a Promise of a matching tuple of awaited values (i.e., `[val1, val2, val3]`).
         *
         * Throws immediately on the first promise that rejects.
         */
        safeAll<T extends readonly unknown[] | []>(
            values: T,
        ): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }>;

        /**
         * If you pass in an iterable (such as a dynamic array), you get back
         * a Promise of an array of awaited values.
         *
         * Throws immediately on the first promise that rejects.
         */
        safeAll<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>[]>;
    }
}

Promise.safeAll = async function safeAll(values: Iterable<unknown>): Promise<unknown[]> {
    const results = await Promise.allSettled(values);
    const unwrappedValues: unknown[] = new Array(results.length);

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'rejected') {
            throw result.reason;
        }
        unwrappedValues[i] = result.value;
    }

    return unwrappedValues;
};

export {};
