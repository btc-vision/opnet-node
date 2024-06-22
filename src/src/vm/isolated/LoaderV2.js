import { Contract } from '@btc-vision/bsi-wasmer-vm';

export async function loadRust(bytecode, MAX_GAS, gasCallbackDifference) {
    const contract = new Contract(bytecode, MAX_GAS);
    contract.lastGas = 0n;

    contract.garbageCollector = function () {
        try {
            const resp = contract.call('__collect', []);
            contract.gasCallback(resp.gasUsed, 'garbageCollector');

            contract.calledGarbageCollector = true;
        } catch (e) {
            throw contract.getError(e);
        }
    };

    contract.gasCallback = function (gas, method) {
        const diff = gas - contract.lastGas;
        contract.lastGas = gas;

        //console.log('Gas used', diff, method);

        gasCallbackDifference(diff);
    };

    contract.abort = function () {
        const abortData = contract.getAbortData();
        const message = __liftString(abortData.message);
        const fileName = __liftString(abortData.fileName);
        const line = abortData.line;
        const column = abortData.column;

        return new Error(`Execution aborted: ${message} at ${fileName}:${line}:${column}`);
    };

    contract.getError = function (err) {
        contract.lastGas = 0n;

        const msg = err.message;
        if (msg.includes('Execution aborted')) {
            return contract.abort();
        } else {
            console.log(err);
            return err;
        }
    };

    contract.__pin = function (pointer) {
        let finalResult;
        try {
            const resp = contract.call('__pin', [pointer]);
            contract.gasCallback(resp.gasUsed, '__pin');

            const result = resp.result.filter((n) => n !== undefined);
            finalResult = result[0];
        } catch (e) {
            throw contract.getError(e);
        }

        return finalResult;
    };

    contract.__unpin = function (pointer) {
        let finalResult;
        try {
            const resp = contract.call('__unpin', [pointer]);
            contract.gasCallback(resp.gasUsed, '__unpin');

            const result = resp.result.filter((n) => n !== undefined);
            finalResult = result[0];
        } catch (e) {
            throw contract.getError(e);
        }

        return finalResult;
    };

    contract.__new = function (size, align) {
        let finalResult;
        try {
            const resp = contract.call('__new', [size, align]);
            contract.gasCallback(resp.gasUsed, '__new');

            const result = resp.result.filter((n) => n !== undefined);
            finalResult = result[0];
        } catch (e) {
            throw contract.getError(e);
        }

        return finalResult;
    };

    const adaptedContract = Object.setPrototypeOf(
        {
            dispose() {
                contract.lastGas = 0n;

                if ('destroy' in contract) {
                    contract.destroy();
                }
            },
            async defineSelectors() {
                try {
                    const resp = contract.call('defineSelectors', []);
                    contract.gasCallback(resp.gasUsed, 'defineSelectors');
                } catch (e) {
                    throw contract.getError(e);
                }
            },
            async readMethod(method, data) {
                try {
                    contract.calledGarbageCollector = false;

                    data = __retain(__lowerTypedArray(13, 0, data) || __notnull());

                    let finalResult;
                    try {
                        const resp = contract.call('readMethod', [method, data]);
                        contract.gasCallback(resp.gasUsed, 'readMethod');

                        const result = resp.result.filter((n) => n !== undefined);
                        finalResult = __liftTypedArray(Uint8Array, result[0] >>> 0);
                    } finally {
                        __release(data);
                    }

                    contract.garbageCollector();

                    return finalResult;
                } catch (e) {
                    throw contract.getError(e);
                }
            },
            async readView(method) {
                let finalResult;
                try {
                    const resp = contract.call('readView', [method]);

                    contract.gasCallback(resp.gasUsed, 'readView');
                    const result = resp.result.filter((n) => n !== undefined);

                    finalResult = __liftTypedArray(Uint8Array, result[0] >>> 0);
                } catch (e) {
                    throw contract.getError(e);
                }

                contract.garbageCollector();
                return finalResult;
            },
            async getViewABI() {
                let finalResult;
                try {
                    const resp = contract.call('getViewABI', []);
                    contract.gasCallback(resp.gasUsed, 'getViewABI');

                    const result = resp.result.filter((n) => n !== undefined);
                    finalResult = __liftTypedArray(Uint8Array, result[0] >>> 0);
                } catch (e) {
                    throw contract.getError(e);
                }

                contract.garbageCollector();
                return finalResult;
            },
            async getEvents() {
                let finalResult;
                try {
                    const resp = contract.call('getEvents', []);
                    contract.gasCallback(resp.gasUsed, 'getEvents');

                    const result = resp.result.filter((n) => n !== undefined);
                    finalResult = __liftTypedArray(Uint8Array, result[0] >>> 0);
                } catch (e) {
                    throw contract.getError(e);
                }

                contract.garbageCollector();
                return finalResult;
            },
            async getMethodABI() {
                let finalResult;
                try {
                    const resp = contract.call('getMethodABI', []);
                    contract.gasCallback(resp.gasUsed, 'getMethodABI');

                    const result = resp.result.filter((n) => n !== undefined);
                    finalResult = __liftTypedArray(Uint8Array, result[0] >>> 0);
                } catch (e) {
                    throw contract.getError(e);
                }

                contract.garbageCollector();
                return finalResult;
            },
            async getWriteMethods() {
                let finalResult;
                try {
                    const resp = contract.call('getWriteMethods', []);
                    contract.gasCallback(resp.gasUsed, 'getWriteMethods');

                    const result = resp.result.filter((n) => n !== undefined);
                    finalResult = __liftTypedArray(Uint8Array, result[0] >>> 0);
                } catch (e) {
                    throw contract.getError(e);
                }

                contract.garbageCollector();
                return finalResult;
            },
            async getModifiedStorage() {
                let finalResult;
                try {
                    const resp = contract.call('getModifiedStorage', []);
                    contract.gasCallback(resp.gasUsed, 'getModifiedStorage');

                    const result = resp.result.filter((n) => n !== undefined);
                    finalResult = __liftTypedArray(Uint8Array, result[0] >>> 0);
                } catch (e) {
                    throw contract.getError(e);
                }

                contract.garbageCollector();
                return finalResult;
            },
            async initializeStorage() {
                let finalResult;
                try {
                    const resp = contract.call('initializeStorage', []);
                    contract.gasCallback(resp.gasUsed, 'initializeStorage');

                    const result = resp.result.filter((n) => n !== undefined);
                    finalResult = __liftTypedArray(Uint8Array, result[0] >>> 0);
                } catch (e) {
                    throw contract.getError(e);
                }

                contract.garbageCollector();
                return finalResult;
            },
            async loadStorage(data) {
                if (contract.calledGarbageCollector === false) {
                    throw new Error('Garbage collector must be called before loadStorage');
                }

                let finalResult;
                try {
                    data = __lowerTypedArray(13, 0, data) || __notnull();
                    const resp = contract.call('loadStorage', [data]);
                    contract.gasCallback(resp.gasUsed, 'loadStorage');

                    const result = resp.result.filter((n) => n !== undefined);
                    finalResult = result[0];
                } catch (e) {
                    throw contract.getError(e);
                }

                contract.garbageCollector();
                return finalResult;
            },
            async loadCallsResponse(data) {
                let finalResult;
                try {
                    data = __lowerTypedArray(13, 0, data) || __notnull();

                    const resp = contract.call('loadCallsResponse', [data]);
                    contract.gasCallback(resp.gasUsed, 'loadCallsResponse');

                    const result = resp.result.filter((n) => n !== undefined);
                    finalResult = result[0];
                } catch (e) {
                    throw contract.getError(e);
                }

                contract.garbageCollector();
                return finalResult;
            },
            async getCalls() {
                let finalResult;
                try {
                    const resp = contract.call('getCalls', []);
                    contract.gasCallback(resp.gasUsed, 'getCalls');

                    const result = resp.result.filter((n) => n !== undefined);
                    finalResult = __liftTypedArray(Uint8Array, result[0] >>> 0);
                } catch (e) {
                    throw contract.getError(e);
                }

                contract.garbageCollector();
                return finalResult;
            },
            async setEnvironment(data) {
                let finalResult;
                try {
                    data = __lowerTypedArray(13, 0, data) || __notnull();

                    const resp = contract.call('setEnvironment', [data]);
                    contract.gasCallback(resp.gasUsed, 'setEnvironment');
                } catch (e) {
                    throw contract.getError(e);
                }

                contract.garbageCollector();
                return finalResult;
            },
            setUsedGas(gas) {
                contract.lastGas = gas;

                try {
                    contract.setUsedGas(gas);
                } catch (e) {
                    throw contract.getError(e);
                }
            },
        },
        {
            __proto__: null,
            __new: contract.__new,
            __pin: contract.__pin,
            __unpin: contract.__unpin,
            garbageCollector: contract.garbageCollector,
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

    function __lowerTypedArray(id, align, values) {
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

        console.log(
            'value',
            value,
            typeof value,
            value instanceof Internref,
            value instanceof Number,
        );

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

    return adaptedContract;
}
