import { Contract } from '@btc-vision/bsi-wasmer-vm';

/**
 * Load the Rust contract
 * @param {ContractParameters} params
 * @returns {Promise<ExportedContract>}
 */
export async function loadRust(params) {
    let gasCallback = params.gasCallback;

    const contract = new Contract(
        params.bytecode,
        params.gasLimit,
        params.network,
        function (_, value) {
            const u = new Uint8Array(value.buffer);
            const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);

            return params.load(buf);
        },
        function (_, value) {
            const u = new Uint8Array(value.buffer);
            const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);

            return params.store(buf);
        },
        function (_, value) {
            const u = new Uint8Array(value.buffer);
            const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);

            return params.call(buf);
        },
        function (_, value) {
            const u = new Uint8Array(value.buffer);
            const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);

            return params.deployContractAtAddress(buf);
        },
        function (_, value) {
            const u = new Uint8Array(value.buffer);
            const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);

            return params.log(buf);
        },
    );

    contract.garbageCollector = async function () {
        /*try {
            const resp = await contract.call('__collect', []);
            contract.gasCallback(resp.gasUsed, 'garbageCollector');
        } catch (e) {
            throw contract.getError(e);
        }*/
    };

    contract.setGasCallback = function (callback) {
        gasCallback = callback;
    };

    /**
     * @param {bigint} gas
     * @param {string} method
     */
    contract.gasCallback = function (gas, method) {
        gasCallback(gas, method);
    };

    contract.abort = async function () {
        const abortData = contract.getAbortData();
        const message = __liftString(abortData.message);
        const fileName = __liftString(abortData.fileName);
        const line = abortData.line;
        const column = abortData.column;

        return new Error(`Execution aborted: ${message} at ${fileName}:${line}:${column}`);
    };

    contract.getError = function (err) {
        const msg = err.message;
        if (msg.includes('Execution aborted') && !msg.includes('Execution aborted:')) {
            return contract.abort();
        } else {
            return err;
        }
    };

    contract.__pin = async function (pointer) {
        let finalResult;
        try {
            const resp = await contract.call('__pin', [pointer]);
            contract.gasCallback(resp.gasUsed, '__pin');

            const result = resp.result.filter((n) => n !== undefined);
            finalResult = result[0];
        } catch (e) {
            throw contract.getError(e);
        }

        return finalResult;
    };

    contract.__unpin = async function (pointer) {
        let finalResult;
        try {
            const resp = await contract.call('__unpin', [pointer]);
            contract.gasCallback(resp.gasUsed, '__unpin');

            const result = resp.result.filter((n) => n !== undefined);
            finalResult = result[0];
        } catch (e) {
            throw contract.getError(e);
        }

        return finalResult;
    };

    contract.__new = async function (size, align) {
        let finalResult;
        try {
            const resp = await contract.call('__new', [size, align]);
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
                contract.destroy();
            },
            async defineSelectors() {
                try {
                    const resp = await contract.call('defineSelectors', []);
                    await contract.gasCallback(resp.gasUsed, 'defineSelectors');
                } catch (e) {
                    throw contract.getError(e);
                }
            },
            async readMethod(method, data) {
                try {
                    const pointer = await __lowerTypedArray(13, 0, data);
                    data = await __retain(pointer || __notnull());

                    let finalResult;
                    try {
                        const resp = await contract.call('readMethod', [method, data]);
                        contract.gasCallback(resp.gasUsed, 'readMethod');

                        const result = resp.result.filter((n) => n !== undefined);
                        finalResult = __liftTypedArray(Uint8Array, result[0] >>> 0);
                    } finally {
                        await __release(data);
                    }

                    await contract.garbageCollector();

                    return finalResult;
                } catch (e) {
                    throw contract.getError(e);
                }
            },
            async readView(method) {
                let finalResult;
                try {
                    const resp = await contract.call('readView', [method]);

                    contract.gasCallback(resp.gasUsed, 'readView');
                    const result = resp.result.filter((n) => n !== undefined);

                    finalResult = __liftTypedArray(Uint8Array, result[0] >>> 0);
                } catch (e) {
                    throw contract.getError(e);
                }

                await contract.garbageCollector();
                return finalResult;
            },
            async getViewABI() {
                let finalResult;
                try {
                    const resp = await contract.call('getViewABI', []);
                    contract.gasCallback(resp.gasUsed, 'getViewABI');

                    const result = resp.result.filter((n) => n !== undefined);
                    finalResult = __liftTypedArray(Uint8Array, result[0] >>> 0);
                } catch (e) {
                    throw contract.getError(e);
                }

                await contract.garbageCollector();
                return finalResult;
            },
            async getEvents() {
                let finalResult;
                try {
                    const resp = await contract.call('getEvents', []);
                    contract.gasCallback(resp.gasUsed, 'getEvents');

                    const result = resp.result.filter((n) => n !== undefined);
                    finalResult = __liftTypedArray(Uint8Array, result[0] >>> 0);
                } catch (e) {
                    throw contract.getError(e);
                }

                await contract.garbageCollector();
                return finalResult;
            },
            async getMethodABI() {
                let finalResult;
                try {
                    const resp = await contract.call('getMethodABI', []);
                    contract.gasCallback(resp.gasUsed, 'getMethodABI');

                    const result = resp.result.filter((n) => n !== undefined);
                    finalResult = __liftTypedArray(Uint8Array, result[0] >>> 0);
                } catch (e) {
                    throw contract.getError(e);
                }

                await contract.garbageCollector();
                return finalResult;
            },
            async getWriteMethods() {
                let finalResult;
                try {
                    const resp = await contract.call('getWriteMethods', []);
                    contract.gasCallback(resp.gasUsed, 'getWriteMethods');

                    const result = resp.result.filter((n) => n !== undefined);
                    finalResult = __liftTypedArray(Uint8Array, result[0] >>> 0);
                } catch (e) {
                    throw contract.getError(e);
                }

                await contract.garbageCollector();
                return finalResult;
            },
            async setEnvironment(data) {
                let finalResult;
                try {
                    data = (await __lowerTypedArray(13, 0, data)) || __notnull();

                    const resp = await contract.call('setEnvironment', [data]);
                    contract.gasCallback(resp.gasUsed, 'setEnvironment');
                } catch (e) {
                    throw contract.getError(e);
                }

                await contract.garbageCollector();
                return finalResult;
            },
            setUsedGas(gas) {
                try {
                    contract.setUsedGas(gas);
                } catch (e) {
                    throw contract.getError(e);
                }
            },
            getUsedGas() {
                try {
                    return contract.getUsedGas();
                } catch (e) {
                    throw contract.getError(e);
                }
            },
            useGas(amount) {
                try {
                    return contract.useGas(amount);
                } catch (e) {
                    throw contract.getError(e);
                }
            },
            getRemainingGas() {
                try {
                    return contract.getRemainingGas();
                } catch (e) {
                    throw contract.getError(e);
                }
            },
            setRemainingGas(gas) {
                try {
                    contract.setRemainingGas(gas);
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

    async function __lowerTypedArray(id, align, values) {
        if (values == null) return 0;

        const length = values.length;
        const bufferSize = length << align;

        // Allocate memory for the array
        const newPointer = await contract.__new(bufferSize, 1);
        const buffer = (await contract.__pin(newPointer)) >>> 0;
        const header = (await contract.__new(12, id)) >>> 0;

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

        await contract.__unpin(buffer);
        return header;
    }

    const refcounts = new Map();

    async function __retain(pointer) {
        if (pointer) {
            const refcount = refcounts.get(pointer);
            if (refcount) refcounts.set(pointer, refcount + 1);
            else {
                const pinned = await contract.__pin(pointer);
                refcounts.set(pinned, 1);
            }
        }

        return pointer;
    }

    async function __release(pointer) {
        if (pointer) {
            const refcount = refcounts.get(pointer);
            if (refcount === 1) {
                await contract.__unpin(pointer);
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
