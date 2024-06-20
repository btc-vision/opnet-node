import { Contract } from '@btc-vision/bsi-wasmer-vm';

export async function loadRust(bytecode, MAX_GAS, gasCallbackDifference) {
    const contract = new Contract(bytecode, MAX_GAS);

    let lastGas = 0n;

    function gasCallback(gas) {
        const diff = gas - lastGas;
        lastGas = gas;

        gasCallbackDifference(diff);
    }

    contract.__pin = function (pointer) {
        try {
            const resp = contract.call('__pin', [pointer]);
            gasCallback(resp.gasUsed);

            const result = resp.result.filter((n) => n !== undefined);
            return result[0];
        } catch (e) {
            throw getError(e);
        }
    };

    contract.__unpin = function (pointer) {
        try {
            const resp = contract.call('__unpin', [pointer]);
            gasCallback(resp.gasUsed);

            const result = resp.result.filter((n) => n !== undefined);
            return result[0];
        } catch (e) {
            throw getError(e);
        }
    };

    contract.__new = function (size, align) {
        try {
            const resp = contract.call('__new', [size, align]);
            gasCallback(resp.gasUsed);

            const result = resp.result.filter((n) => n !== undefined);
            return result[0];
        } catch (e) {
            throw getError(e);
        }
    };

    function getError(err) {
        lastGas = 0n;

        const msg = err.message;
        if (msg.includes('Execution aborted')) {
            const abortData = contract.getAbortData();
            const message = __liftString(abortData.message);
            const fileName = __liftString(abortData.fileName);
            const line = abortData.line;
            const column = abortData.column;

            return new Error(`${message} at ${fileName}:${line}:${column}`);
        } else {
            return err;
        }
    }

    const adaptedExports = Object.setPrototypeOf(
        {
            getContract() {
                try {
                    const resp = contract.call('getContract', []);
                    gasCallback(resp.gasUsed);

                    const result = resp.result.filter((n) => n !== undefined);
                    return __liftInternref(result[0] >>> 0);
                } catch (e) {
                    throw getError(e);
                }
            },
            readMethod(method, contractPointer, data) {
                try {
                    contractPointer = __retain(__lowerInternref(contractPointer));
                    data = __retain(__lowerTypedArray(Uint8Array, 13, 0, data) || __notnull());

                    try {
                        const resp = contract.call('readMethod', [method, contractPointer, data]);

                        gasCallback(resp.gasUsed);

                        const result = resp.result.filter((n) => n !== undefined);
                        return __liftTypedArray(Uint8Array, result[0] >>> 0);
                    } finally {
                        __release(contractPointer);
                        __release(data);
                    }
                } catch (e) {
                    throw getError(e);
                }
            },
            readView(method, contractPointer) {
                try {
                    contractPointer = __lowerInternref(contractPointer);

                    const resp = contract.call('readView', [method, contractPointer]);

                    gasCallback(resp.gasUsed);
                    const result = resp.result.filter((n) => n !== undefined);

                    return __liftTypedArray(Uint8Array, result[0] >>> 0);
                } catch (e) {
                    throw getError(e);
                }
            },
            getViewABI() {
                try {
                    const resp = contract.call('getViewABI', []);

                    gasCallback(resp.gasUsed);
                    const result = resp.result.filter((n) => n !== undefined);

                    return __liftTypedArray(Uint8Array, result[0] >>> 0);
                } catch (e) {
                    throw getError(e);
                }
            },
            getEvents() {
                try {
                    const resp = contract.call('getEvents', []);

                    gasCallback(resp.gasUsed);
                    const result = resp.result.filter((n) => n !== undefined);

                    return __liftTypedArray(Uint8Array, result[0] >>> 0);
                } catch (e) {
                    throw getError(e);
                }
            },
            getMethodABI() {
                try {
                    const resp = contract.call('getMethodABI', []);

                    gasCallback(resp.gasUsed);
                    const result = resp.result.filter((n) => n !== undefined);

                    return __liftTypedArray(Uint8Array, result[0] >>> 0);
                } catch (e) {
                    throw getError(e);
                }
            },
            getWriteMethods() {
                try {
                    const resp = contract.call('getWriteMethods', []);

                    gasCallback(resp.gasUsed);
                    const result = resp.result.filter((n) => n !== undefined);

                    return __liftTypedArray(Uint8Array, result[0] >>> 0);
                } catch (e) {
                    throw getError(e);
                }
            },
            getModifiedStorage() {
                try {
                    const resp = contract.call('getModifiedStorage', []);

                    gasCallback(resp.gasUsed);
                    const result = resp.result.filter((n) => n !== undefined);

                    return __liftTypedArray(Uint8Array, result[0] >>> 0);
                } catch (e) {
                    throw getError(e);
                }
            },
            initializeStorage() {
                try {
                    const resp = contract.call('initializeStorage', []);

                    gasCallback(resp.gasUsed);
                    const result = resp.result.filter((n) => n !== undefined);

                    return __liftTypedArray(Uint8Array, result[0] >>> 0);
                } catch (e) {
                    throw getError(e);
                }
            },
            loadStorage(data) {
                try {
                    data = __lowerTypedArray(Uint8Array, 13, 0, data) || __notnull();
                    const resp = contract.call('loadStorage', [data]);

                    gasCallback(resp.gasUsed);
                    const result = resp.result.filter((n) => n !== undefined);

                    return result[0];
                } catch (e) {
                    throw getError(e);
                }
            },
            loadCallsResponse(data) {
                try {
                    data = __lowerTypedArray(Uint8Array, 13, 0, data) || __notnull();

                    const resp = contract.call('loadCallsResponse', [data]);

                    gasCallback(resp.gasUsed);
                    const result = resp.result.filter((n) => n !== undefined);

                    return result[0];
                } catch (e) {
                    throw getError(e);
                }
            },
            getCalls() {
                try {
                    const resp = contract.call('getCalls', []);

                    gasCallback(resp.gasUsed);
                    const result = resp.result.filter((n) => n !== undefined);

                    return __liftTypedArray(Uint8Array, result[0] >>> 0);
                } catch (e) {
                    throw getError(e);
                }
            },
            setEnvironment(data) {
                try {
                    data = __lowerTypedArray(Uint8Array, 13, 0, data) || __notnull();

                    const resp = contract.call('setEnvironment', [data]);
                    gasCallback(resp.gasUsed);
                } catch (e) {
                    throw getError(e);
                }
            },
            purgeMemory() {
                try {
                    const resp = contract.call('purgeMemory', []);

                    gasCallback(resp.gasUsed);
                } catch (e) {
                    throw getError(e);
                }
            },

            setUsedGas(gas) {
                lastGas = gas;

                try {
                    contract.setUsedGas(gas);
                } catch (e) {
                    throw getError(e);
                }
            },
        },
        {
            __proto__: null,
            __liftString,
            __liftTypedArray,
            __lowerTypedArray,
            __liftInternref,
            __lowerInternref,
            __retain,
            __release,
        },
    );

    function __liftString(pointer) {
        if (!pointer) return null;

        // Read the length of the string
        const lengthPointer = pointer - 4;
        const lengthBuffer = contract.readMemory(BigInt(lengthPointer), 4n);
        const length = new Uint32Array(lengthBuffer.buffer)[0];

        const end = (pointer + length) >>> 1;
        const stringParts = [];
        let start = pointer >>> 1;

        while (end - start > 1024) {
            const chunkBuffer = contract.readMemory(BigInt(start * 2), 2048n);
            const memoryU16 = new Uint16Array(chunkBuffer.buffer);
            stringParts.push(String.fromCharCode(...memoryU16));
            start += 1024;
        }

        const remainingBuffer = contract.readMemory(BigInt(start * 2), BigInt((end - start) * 2));
        const remainingU16 = new Uint16Array(remainingBuffer.buffer);
        stringParts.push(String.fromCharCode(...remainingU16));

        return stringParts.join('');
    }

    function __liftTypedArray(constructor, pointer) {
        if (!pointer) return null;

        // Read the data offset and length
        const buffer = contract.readMemory(BigInt(pointer + 4), 8n);

        const dataView = new DataView(buffer.buffer);
        const dataOffset = dataView.getUint32(0, true);
        const length = dataView.getUint32(4, true) / constructor.BYTES_PER_ELEMENT;

        // Read the actual data
        const dataBuffer = contract.readMemory(
            BigInt(dataOffset),
            BigInt(length * constructor.BYTES_PER_ELEMENT),
        );

        // Create the typed array and return its slice
        const typedArray = new constructor(dataBuffer.buffer);
        return typedArray.slice();
    }

    function __lowerTypedArray(constructor, id, align, values) {
        if (values == null) return 0;

        const length = values.length;
        const bufferSize = length << align;

        // Allocate memory for the array
        const buffer = contract.__pin(contract.__new(bufferSize, 1)) >>> 0;
        const header = contract.__new(12, id) >>> 0;

        // Set the buffer and length in the header
        const headerBuffer = new Uint8Array(12);
        const headerView = new DataView(headerBuffer.buffer);
        headerView.setUint32(0, buffer, true);
        headerView.setUint32(4, buffer, true);
        headerView.setUint32(8, bufferSize, true);
        contract.writeMemory(BigInt(header), headerBuffer);

        // Write the values into the buffer
        const valuesBuffer = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
        contract.writeMemory(BigInt(buffer), valuesBuffer);

        contract.__unpin(buffer);
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
        if (value instanceof Number) return value.valueOf();

        throw TypeError('internref expected');
    }

    const refcounts = new Map();

    function __retain(pointer) {
        if (pointer) {
            const refcount = refcounts.get(pointer);
            if (refcount) refcounts.set(pointer, refcount + 1);
            else refcounts.set(contract.__pin(pointer), 1);
        }
        return pointer;
    }

    function __release(pointer) {
        if (pointer) {
            const refcount = refcounts.get(pointer);
            if (refcount === 1) {
                contract.__unpin(pointer);
                refcounts.delete(pointer);
            } else if (refcount) {
                refcounts.set(pointer, refcount - 1);
            } else {
                throw Error(`invalid refcount '${refcount}' for reference '${pointer}'`);
            }
        }
    }

    function __notnull() {
        throw TypeError('value must not be null');
    }

    return adaptedExports;
}
