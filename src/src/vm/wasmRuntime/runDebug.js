// const module = await globalThis.WebAssembly.compile(bytecode);

export async function instantiate(bytecode, imports = {}) {
    const module = await globalThis.WebAssembly.compile(bytecode);

    const adaptedImports = {
        env: Object.assign(Object.create(globalThis), imports.env || {}, {
            abort(message, fileName, lineNumber, columnNumber) {
                // ~lib/builtins/abort(~lib/string/String | null?, ~lib/string/String | null?, u32?, u32?) => void
                message = __liftString(message >>> 0);
                fileName = __liftString(fileName >>> 0);
                lineNumber = lineNumber >>> 0;
                columnNumber = columnNumber >>> 0;
                (() => {
                    // @external.js
                    throw Error(`${message} in ${fileName}:${lineNumber}:${columnNumber}`);
                })();
            },
            'console.log'(text) {
                // ~lib/bindings/dom/console.log(~lib/string/String) => void
                text = __liftString(text >>> 0);
                console.log(text);
            },
        }),
    };
    const { exports } = await WebAssembly.instantiate(module, adaptedImports);
    const memory = exports.memory || imports.env.memory;
    const adaptedExports = Object.setPrototypeOf(
        {
            getContract() {
                // src/index/getContract() => src/btc/contracts/BTCContract/BTCContract
                return __liftInternref(exports.getContract() >>> 0);
            },
            readMethod(method, contract, data, caller) {
                // src/btc/exports/index/readMethod(u32, src/btc/contracts/BTCContract/BTCContract | null, ~lib/typedarray/Uint8Array, ~lib/string/String | null) => ~lib/typedarray/Uint8Array
                contract = __retain(__lowerInternref(contract));
                data = __retain(__lowerTypedArray(Uint8Array, 13, 0, data) || __notnull());
                caller = __lowerString(caller);
                try {
                    return __liftTypedArray(
                        Uint8Array,
                        exports.readMethod(method, contract, data, caller) >>> 0,
                    );
                } finally {
                    __release(contract);
                    __release(data);
                }
            },
            INIT(owner, contractAddress) {
                // src/btc/exports/index/INIT(~lib/string/String, ~lib/string/String) => void
                owner = __retain(__lowerString(owner) || __notnull());
                contractAddress = __lowerString(contractAddress) || __notnull();
                try {
                    exports.INIT(owner, contractAddress);
                } finally {
                    __release(owner);
                }
            },
            readView(method, contract) {
                // src/btc/exports/index/readView(u32, src/btc/contracts/BTCContract/BTCContract | null) => ~lib/typedarray/Uint8Array
                contract = __lowerInternref(contract);
                return __liftTypedArray(Uint8Array, exports.readView(method, contract) >>> 0);
            },
            getViewABI() {
                // src/btc/exports/index/getViewABI() => ~lib/typedarray/Uint8Array
                return __liftTypedArray(Uint8Array, exports.getViewABI() >>> 0);
            },
            getEvents() {
                // src/btc/exports/index/getEvents() => ~lib/typedarray/Uint8Array
                return __liftTypedArray(Uint8Array, exports.getEvents() >>> 0);
            },
            getMethodABI() {
                // src/btc/exports/index/getMethodABI() => ~lib/typedarray/Uint8Array
                return __liftTypedArray(Uint8Array, exports.getMethodABI() >>> 0);
            },
            getWriteMethods() {
                // src/btc/exports/index/getMethodABI() => ~lib/typedarray/Uint8Array
                return __liftTypedArray(Uint8Array, exports.getWriteMethods() >>> 0);
            },
            getRequiredStorage() {
                // src/btc/exports/index/getRequiredStorage() => ~lib/typedarray/Uint8Array
                return __liftTypedArray(Uint8Array, exports.getRequiredStorage() >>> 0);
            },
            getModifiedStorage() {
                // src/btc/exports/index/getModifiedStorage() => ~lib/typedarray/Uint8Array
                return __liftTypedArray(Uint8Array, exports.getModifiedStorage() >>> 0);
            },
            loadStorage(data) {
                // src/btc/exports/index/loadStorage(~lib/typedarray/Uint8Array) => void
                data = __lowerTypedArray(Uint8Array, 13, 0, data) || __notnull();
                exports.loadStorage(data);
            },
            allocateMemory(size) {
                // src/btc/exports/index/allocateMemory(usize) => usize
                return exports.allocateMemory(size) >>> 0;
            },
            isInitialized() {
                // src/btc/exports/index/isInitialized() => bool
                return exports.isInitialized() != 0;
            },
        },
        exports,
    );

    function __liftString(pointer) {
        if (!pointer) return null;
        const end = (pointer + new Uint32Array(memory.buffer)[(pointer - 4) >>> 2]) >>> 1,
            memoryU16 = new Uint16Array(memory.buffer);
        let start = pointer >>> 1,
            string = '';
        while (end - start > 1024)
            string += String.fromCharCode(...memoryU16.subarray(start, (start += 1024)));
        return string + String.fromCharCode(...memoryU16.subarray(start, end));
    }

    function __lowerString(value) {
        if (value == null) return 0;
        const length = value.length,
            pointer = exports.__new(length << 1, 2) >>> 0,
            memoryU16 = new Uint16Array(memory.buffer);
        for (let i = 0; i < length; ++i) memoryU16[(pointer >>> 1) + i] = value.charCodeAt(i);
        return pointer;
    }

    function __liftTypedArray(constructor, pointer) {
        if (!pointer) return null;
        return new constructor(
            memory.buffer,
            __getU32(pointer + 4),
            __dataview.getUint32(pointer + 8, true) / constructor.BYTES_PER_ELEMENT,
        ).slice();
    }

    function __lowerTypedArray(constructor, id, align, values) {
        if (values == null) return 0;
        const length = values.length,
            buffer = exports.__pin(exports.__new(length << align, 1)) >>> 0,
            header = exports.__new(12, id) >>> 0;
        __setU32(header + 0, buffer);
        __dataview.setUint32(header + 4, buffer, true);
        __dataview.setUint32(header + 8, length << align, true);
        new constructor(memory.buffer, buffer, length).set(values);
        exports.__unpin(buffer);
        return header;
    }

    class Internref extends Number {}

    const registry = new FinalizationRegistry(__release);

    function __liftInternref(pointer) {
        if (!pointer) return null;
        const sentinel = new Internref(__retain(pointer));
        registry.register(sentinel, pointer);
        return sentinel;
    }

    function __lowerInternref(value) {
        if (value == null) return 0;
        if (value instanceof Internref) return value.valueOf();
        throw TypeError('internref expected');
    }

    const refcounts = new Map();

    function __retain(pointer) {
        if (pointer) {
            const refcount = refcounts.get(pointer);
            if (refcount) refcounts.set(pointer, refcount + 1);
            else refcounts.set(exports.__pin(pointer), 1);
        }
        return pointer;
    }

    function __release(pointer) {
        if (pointer) {
            const refcount = refcounts.get(pointer);
            if (refcount === 1) exports.__unpin(pointer), refcounts.delete(pointer);
            else if (refcount) refcounts.set(pointer, refcount - 1);
            else throw Error(`invalid refcount '${refcount}' for reference '${pointer}'`);
        }
    }

    function __notnull() {
        throw TypeError('value must not be null');
    }

    let __dataview = new DataView(memory.buffer);

    function __setU32(pointer, value) {
        try {
            __dataview.setUint32(pointer, value, true);
        } catch {
            __dataview = new DataView(memory.buffer);
            __dataview.setUint32(pointer, value, true);
        }
    }

    function __getU32(pointer) {
        try {
            return __dataview.getUint32(pointer, true);
        } catch {
            __dataview = new DataView(memory.buffer);
            return __dataview.getUint32(pointer, true);
        }
    }

    return adaptedExports;
}
