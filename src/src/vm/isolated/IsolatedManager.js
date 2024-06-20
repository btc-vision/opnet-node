import { Contract } from '@btc-vision/bsi-wasmer-vm';

const contract = new Contract(module, MAX_GAS);
contract.__pin = function (pointer) {
    const resp = contract.call('__pin', [pointer]).filter((n) => n !== undefined);

    return resp[0];
};

contract.__unpin = function (pointer) {
    const resp = contract.call('__unpin', [pointer]).filter((n) => n !== undefined);

    return resp[0];
};

contract.__new = function (size, align) {
    const resp = contract.call('__new', [size, align]).filter((n) => n !== undefined);

    return resp[0];
};

const adaptedExports = Object.setPrototypeOf(
    {
        getContract() {
            const resp = contract.call('getContract', []);
            gasCallback(resp.gasUsed);

            const result = resp.result.filter((n) => n !== undefined);
            return __liftInternref(result[0] >>> 0);
        },
        readMethod(method, contractPointer, data) {
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
        },
        readView(method, contractPointer) {
            contractPointer = __lowerInternref(contractPointer);

            const resp = contract.call('readView', [method, contractPointer]);

            gasCallback(resp.gasUsed);
            const result = resp.result.filter((n) => n !== undefined);

            return __liftTypedArray(Uint8Array, result[0] >>> 0);
        },
        getViewABI() {
            const resp = contract.call('getViewABI', []);

            gasCallback(resp.gasUsed);
            const result = resp.result.filter((n) => n !== undefined);

            return __liftTypedArray(Uint8Array, result[0] >>> 0);
        },
        getEvents() {
            const resp = contract.call('getEvents', []);

            gasCallback(resp.gasUsed);
            const result = resp.result.filter((n) => n !== undefined);

            return __liftTypedArray(Uint8Array, result[0] >>> 0);
        },
        getMethodABI() {
            const resp = contract.call('getMethodABI', []);

            gasCallback(resp.gasUsed);
            const result = resp.result.filter((n) => n !== undefined);

            return __liftTypedArray(Uint8Array, result[0] >>> 0);
        },
        getWriteMethods() {
            const resp = contract.call('getWriteMethods', []);

            gasCallback(resp.gasUsed);
            const result = resp.result.filter((n) => n !== undefined);

            return __liftTypedArray(Uint8Array, result[0] >>> 0);
        },
        getModifiedStorage() {
            const resp = contract.call('getModifiedStorage', []);

            gasCallback(resp.gasUsed);
            const result = resp.result.filter((n) => n !== undefined);

            return __liftTypedArray(Uint8Array, result[0] >>> 0);
        },
        initializeStorage() {
            const resp = contract.call('initializeStorage', []);

            gasCallback(resp.gasUsed);
            const result = resp.result.filter((n) => n !== undefined);

            return __liftTypedArray(Uint8Array, result[0] >>> 0);
        },
        loadStorage(data) {
            data = __lowerTypedArray(Uint8Array, 13, 0, data) || __notnull();
            const resp = contract.call('loadStorage', [data]);

            gasCallback(resp.gasUsed);
            const result = resp.result.filter((n) => n !== undefined);

            return result[0];
        },
        loadCallsResponse(data) {
            data = __lowerTypedArray(Uint8Array, 13, 0, data) || __notnull();

            const resp = contract.call('loadCallsResponse', [data]);

            gasCallback(resp.gasUsed);
            const result = resp.result.filter((n) => n !== undefined);

            return result[0];
        },
        getCalls() {
            const resp = contract.call('getCalls', []);

            gasCallback(resp.gasUsed);
            const result = resp.result.filter((n) => n !== undefined);

            return __liftTypedArray(Uint8Array, result[0] >>> 0);
        },
        setEnvironment(data) {
            data = __lowerTypedArray(Uint8Array, 13, 0, data) || __notnull();

            const resp = contract.call('setEnvironment', [data]);
            gasCallback(resp.gasUsed);
        },
    },
    contract,
);

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

export function getContract() {
    // src/index/getContract() => src/btc/contracts/BTCContract/BTCContract
    return adaptedExports.getContract();
}

export function readMethod(method, contract, data, caller) {
    // src/btc/exports/index/readMethod(u32, src/btc/contracts/BTCContract/BTCContract | null, ~lib/typedarray/Uint8Array, ~lib/string/String | null) => ~lib/typedarray/Uint8Array
    return adaptedExports.readMethod(method, contract, data, caller);
}

export function readView(method, contract) {
    // src/btc/exports/index/readView(u32, src/btc/contracts/BTCContract/BTCContract | null) => ~lib/typedarray/Uint8Array
    return adaptedExports.readView(method, contract);
}

export function getViewABI() {
    // src/btc/exports/index/getViewABI() => ~lib/typedarray/Uint8Array
    return adaptedExports.getViewABI();
}

export function getEvents() {
    // src/btc/exports/index/getEvents() => ~lib/typedarray/Uint8Array
    return adaptedExports.getEvents();
}

export function getMethodABI() {
    // src/btc/exports/index/getMethodABI() => ~lib/typedarray/Uint8Array
    return adaptedExports.getMethodABI();
}

export function getWriteMethods() {
    // src/btc/exports/index/getMethodABI() => ~lib/typedarray/Uint8Array
    return adaptedExports.getWriteMethods();
}

export function getModifiedStorage() {
    // src/btc/exports/index/getModifiedStorage() => ~lib/typedarray/Uint8Array
    return adaptedExports.getModifiedStorage();
}

export function initializeStorage() {
    // src/btc/exports/index/initializeStorage() => ~lib/typedarray/Uint8Array
    return adaptedExports.initializeStorage();
}

export function loadStorage(data) {
    // src/btc/exports/index/loadStorage(~lib/typedarray/Uint8Array) => void
    adaptedExports.loadStorage(data);
}

export function loadCallsResponse(data) {
    adaptedExports.loadCallsResponse(data);
}

export function getCalls() {
    return adaptedExports.getCalls();
}

export function setEnvironment(data) {
    adaptedExports.setEnvironment(data);
}

/**
 * @param {BigInt} gasProvided
 * @param {BigInt} gasUsed
 */
export function setMaxGas(gasProvided, gasUsed) {
    const usedGas = MAX_GAS - gasProvided + gasUsed;

    contract.setUsedGas(usedGas);
}
