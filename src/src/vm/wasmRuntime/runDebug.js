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
            'console.log'(s) {
                // src/btc/env/index/consoleLog(~lib/string/String) => void
                s = __liftString(s >>> 0);
                console.log(s);
            },
        }),
    };
    const { exports } = await WebAssembly.instantiate(module, adaptedImports);

    const memory = exports.memory || imports.env.memory;
    const adaptedExports = Object.setPrototypeOf(
        {
            INIT(owner, self) {
                // src/index/CONTRACT(~lib/string/String, ~lib/string/String) => contracts/MotoSwapFactory/MotoSwapFactory
                owner = __retain(__lowerString(owner) || __notnull());
                self = __lowerString(self) || __notnull();
                try {
                    return __liftInternref(exports.INIT(owner, self) >>> 0);
                } finally {
                    __release(owner);
                }
            },
            readMethod(method, contract, calldata) {
                // src/btc/exports/index/readMethod(u32, src/btc/contracts/BTCContract/BTCContract | null, src/btc/buffer/BytesReader/BytesReader) => ~lib/typedarray/Uint8Array
                contract = __retain(__lowerInternref(contract));
                calldata = __lowerInternref(calldata) || __notnull();
                try {
                    return __liftTypedArray(
                        Uint8Array,
                        exports.readMethod(method, contract, calldata) >>> 0,
                    );
                } finally {
                    __release(contract);
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
            getMethodABI() {
                // src/btc/exports/index/getMethodABI() => ~lib/typedarray/Uint8Array
                return __liftTypedArray(Uint8Array, exports.getMethodABI() >>> 0);
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
