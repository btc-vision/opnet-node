import {
    BitcoinNetworkRequest,
    ContractManager,
    ThreadSafeJsImportResponse,
} from '@btc-vision/op-vm';

export const contractManager = new ContractManager();

export interface ContractParameters {
    readonly bytecode: Buffer;
    readonly gasLimit: bigint;
    readonly network: BitcoinNetworkRequest;
    readonly gasCallback: (gas: bigint, method: string) => void;

    readonly load: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly store: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly call: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly deployContractAtAddress: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly log: (data: Buffer) => void;
}

export class RustContract {
    private refCounts: Map<number, number> = new Map();

    constructor(params: ContractParameters) {
        this._params = params;
    }

    private _id?: bigint;

    public get id() {
        if (this.disposed) throw new Error('Contract is disposed');

        if (!this._id) {
            this._id = contractManager.instantiate(
                this.params.bytecode,
                this.params.gasLimit,
                this.params.network,
                (
                    _: never,
                    value: ThreadSafeJsImportResponse,
                ): Promise<ThreadSafeJsImportResponse> => {
                    return new Promise(
                        async (
                            resolve: (value: ThreadSafeJsImportResponse) => void,
                            reject: (reason: string) => void,
                        ) => {
                            try {
                                const u = new Uint8Array(value.buffer);
                                const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);
                                const resp = await this.params.load(buf);

                                // Convert buffer to array
                                resolve({
                                    buffer: Array.from(resp),
                                });
                            } catch (e) {
                                const error = e as Error;

                                reject(error.stack ?? 'Failed to load.');
                            }
                        },
                    );
                },
                (
                    _: never,
                    value: ThreadSafeJsImportResponse,
                ): Promise<ThreadSafeJsImportResponse> => {
                    return new Promise(
                        async (
                            resolve: (value: ThreadSafeJsImportResponse) => void,
                            reject: (reason: string) => void,
                        ) => {
                            try {
                                const u = new Uint8Array(value.buffer);
                                const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);
                                const resp = await this.params.store(buf);

                                // Convert buffer to array
                                resolve({
                                    buffer: Array.from(resp),
                                });
                            } catch (e) {
                                const error = e as Error;

                                reject(error.stack ?? 'Failed to store.');
                            }
                        },
                    );
                },
                (
                    _: never,
                    value: ThreadSafeJsImportResponse,
                ): Promise<ThreadSafeJsImportResponse> => {
                    return new Promise(
                        async (
                            resolve: (value: ThreadSafeJsImportResponse) => void,
                            reject: (reason: string) => void,
                        ) => {
                            try {
                                const u = new Uint8Array(value.buffer);
                                const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);
                                const resp = await this.params.call(buf);

                                // Convert buffer to array
                                resolve({
                                    buffer: Array.from(resp),
                                });
                            } catch (e) {
                                const error = e as Error;

                                reject(error.stack ?? 'Failed to call contract.');
                            }
                        },
                    );
                },
                (
                    _: never,
                    value: ThreadSafeJsImportResponse,
                ): Promise<ThreadSafeJsImportResponse> => {
                    return new Promise(
                        async (
                            resolve: (value: ThreadSafeJsImportResponse) => void,
                            reject: (reason: string) => void,
                        ) => {
                            try {
                                const u = new Uint8Array(value.buffer);
                                const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);
                                const resp = await this.params.deployContractAtAddress(buf);

                                // Convert buffer to array
                                resolve({
                                    buffer: Array.from(resp),
                                });
                            } catch (e) {
                                const error = e as Error;

                                reject(error.stack ?? 'Failed to deploy contract.');
                            }
                        },
                    );
                },
                (_: never, value: ThreadSafeJsImportResponse): Promise<void> => {
                    return new Promise(
                        async (resolve: () => void, reject: (reason: string) => void) => {
                            try {
                                const u = new Uint8Array(value.buffer);
                                const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);
                                this.params.log(buf);

                                resolve();
                            } catch (e) {
                                const error = e as Error;

                                reject(error.stack ?? 'Failed to log.');
                            }
                        },
                    );
                },
            );
        }

        return this._id;
    }

    private _disposed: boolean = false;

    public get disposed(): boolean {
        return this._disposed;
    }

    private _params?: ContractParameters | null;

    private get params(): ContractParameters {
        if (!this._params) {
            throw new Error('Contract is disposed');
        }

        return this._params;
    }

    public dispose(): void {
        if (this._id == null) {
            throw new Error('Contract is not instantiated');
        }

        this.refCounts.clear();

        if (this.disposed) return;
        this._disposed = true;

        delete this._params;

        try {
            contractManager.destroy(this._id);
        } catch {}
    }

    public async defineSelectors(): Promise<void> {
        try {
            const resp = await contractManager.call(this.id, 'defineSelectors', []);
            this.gasCallback(resp.gasUsed, 'defineSelectors');
        } catch (e) {
            const error = e as Error;
            throw await this.getError(error);
        }
    }

    public async readMethod(method: number, buffer: Uint8Array | Buffer): Promise<Uint8Array> {
        try {
            const pointer = await this.__lowerTypedArray(13, 0, buffer);
            const data = await this.__retain(pointer);

            let finalResult;
            try {
                const resp = await contractManager.call(this.id, 'readMethod', [method, data]);
                this.gasCallback(resp.gasUsed, 'readMethod');

                const result = resp.result.filter((n) => n !== undefined);
                finalResult = this.__liftTypedArray(result[0] >>> 0);
            } finally {
                await this.__release(data);
            }

            this.dispose();

            return finalResult;
        } catch (e) {
            const error = e as Error;
            throw await this.getError(error);
        }
    }

    public async readView(method: number): Promise<Uint8Array> {
        let finalResult;
        try {
            const resp = await contractManager.call(this.id, 'readView', [method]);

            this.gasCallback(resp.gasUsed, 'readView');
            const result = resp.result.filter((n) => n !== undefined);

            finalResult = this.__liftTypedArray(result[0] >>> 0);

            this.dispose();
        } catch (e) {
            const error = e as Error;
            throw await this.getError(error);
        }

        return finalResult;
    }

    public async getViewABI(): Promise<Uint8Array> {
        let finalResult;
        try {
            const resp = await contractManager.call(this.id, 'getViewABI', []);
            this.gasCallback(resp.gasUsed, 'getViewABI');

            const result = resp.result.filter((n) => n !== undefined);
            finalResult = this.__liftTypedArray(result[0] >>> 0);
        } catch (e) {
            const error = e as Error;
            throw await this.getError(error);
        }

        return finalResult;
    }

    public async getEvents(): Promise<Uint8Array> {
        let finalResult: Uint8Array;
        try {
            const resp = await contractManager.call(this.id, 'getEvents', []);
            this.gasCallback(resp.gasUsed, 'getEvents');

            const result = resp.result.filter((n) => n !== undefined);
            finalResult = this.__liftTypedArray(result[0] >>> 0);
        } catch (e) {
            const error = e as Error;
            throw await this.getError(error);
        }

        return finalResult;
    }

    public async getMethodABI(): Promise<Uint8Array> {
        let finalResult;
        try {
            const resp = await contractManager.call(this.id, 'getMethodABI', []);
            this.gasCallback(resp.gasUsed, 'getMethodABI');

            const result = resp.result.filter((n) => n !== undefined);
            finalResult = this.__liftTypedArray(result[0] >>> 0);
        } catch (e) {
            const error = e as Error;
            throw await this.getError(error);
        }

        return finalResult;
    }

    public async getWriteMethods(): Promise<Uint8Array> {
        let finalResult;
        try {
            const resp = await contractManager.call(this.id, 'getWriteMethods', []);
            this.gasCallback(resp.gasUsed, 'getWriteMethods');

            const result = resp.result.filter((n) => n !== undefined);
            finalResult = this.__liftTypedArray(result[0] >>> 0);
        } catch (e) {
            const error = e as Error;
            throw await this.getError(error);
        }

        return finalResult;
    }

    public async setEnvironment(buffer: Uint8Array | Buffer): Promise<void> {
        try {
            const data = await this.__lowerTypedArray(13, 0, buffer);
            if (data == null) throw new Error('Data cannot be null');

            const resp = await contractManager.call(this.id, 'setEnvironment', [data]);
            this.gasCallback(resp.gasUsed, 'setEnvironment');
        } catch (e) {
            const error = e as Error;
            throw await this.getError(error);
        }
    }

    public async setUsedGas(gas: bigint): Promise<void> {
        try {
            contractManager.setUsedGas(this.id, gas);
        } catch (e) {
            const error = e as Error;
            throw await this.getError(error);
        }
    }

    public async getUsedGas(): Promise<bigint> {
        try {
            return contractManager.getUsedGas(this.id);
        } catch (e) {
            const error = e as Error;
            throw await this.getError(error);
        }
    }

    public async useGas(amount: bigint): Promise<void> {
        try {
            return contractManager.useGas(this.id, amount);
        } catch (e) {
            const error = e as Error;
            throw await this.getError(error);
        }
    }

    public async getRemainingGas(): Promise<bigint> {
        try {
            return contractManager.getRemainingGas(this.id);
        } catch (e) {
            const error = e as Error;
            throw await this.getError(error);
        }
    }

    public async setRemainingGas(gas: bigint): Promise<void> {
        try {
            contractManager.setRemainingGas(this.id, gas);
        } catch (e) {
            const error = e as Error;
            throw await this.getError(error);
        }
    }

    private async __retain(pointer: number): Promise<number> {
        if (pointer) {
            const refcount = this.refCounts.get(pointer);
            if (refcount) {
                this.refCounts.set(pointer, refcount + 1);
            } else {
                const pinned = await this.__pin(pointer);
                this.refCounts.set(pinned, 1);
            }
        }

        return pointer;
    }

    private async __release(pointer: number): Promise<void> {
        if (pointer) {
            const refcount = this.refCounts.get(pointer);
            if (refcount === 1) {
                await this.__unpin(pointer);
                this.refCounts.delete(pointer);
            } else if (refcount) {
                this.refCounts.set(pointer, refcount - 1);
            } else {
                throw Error(`invalid refcount '${refcount}' for reference '${pointer}'`);
            }
        }
    }

    private __liftString(pointer: number): string | null {
        if (!pointer) return null;

        // Read the length of the string
        const lengthPointer = pointer - 4;
        const lengthBuffer = contractManager.readMemory(this.id, BigInt(lengthPointer), 4n);
        const length = new Uint32Array(lengthBuffer.buffer)[0];

        const end = (pointer + length) >>> 1;
        const stringParts = [];
        let start = pointer >>> 1;

        while (end - start > 1024) {
            const chunkBuffer = contractManager.readMemory(this.id, BigInt(start * 2), 2048n);
            const memoryU16 = new Uint16Array(chunkBuffer.buffer);
            stringParts.push(String.fromCharCode(...memoryU16));
            start += 1024;
        }

        const remainingBuffer = contractManager.readMemory(
            this.id,
            BigInt(start * 2),
            BigInt((end - start) * 2),
        );

        const remainingU16 = new Uint16Array(remainingBuffer.buffer);
        stringParts.push(String.fromCharCode(...remainingU16));

        return stringParts.join('');
    }

    private __liftTypedArray(pointer: number): Uint8Array {
        if (!pointer) throw new Error('Pointer cannot be null');

        // Read the data offset and length
        const buffer = contractManager.readMemory(this.id, BigInt(pointer + 4), 8n);

        const dataView = new DataView(buffer.buffer);
        const dataOffset = dataView.getUint32(0, true);
        const length = dataView.getUint32(4, true) / Uint8Array.BYTES_PER_ELEMENT;

        // Read the actual data
        const dataBuffer = contractManager.readMemory(
            this.id,
            BigInt(dataOffset),
            BigInt(length * Uint8Array.BYTES_PER_ELEMENT),
        );

        // Create the typed array and return its slice
        const typedArray = new Uint8Array(dataBuffer.buffer);
        return typedArray.slice();
    }

    private async __lowerTypedArray(
        id: number,
        align: number,
        values: Uint8Array | Buffer,
    ): Promise<number> {
        if (values == null) return 0;

        const length = values.length;
        const bufferSize = length << align;

        // Allocate memory for the array
        const newPointer = await this.__new(bufferSize, 1);
        const buffer = (await this.__pin(newPointer)) >>> 0;
        const header = (await this.__new(12, id)) >>> 0;

        // Set the buffer and length in the header
        const headerBuffer = Buffer.alloc(12);
        const headerView = new DataView(headerBuffer.buffer);
        headerView.setUint32(0, buffer, true);
        headerView.setUint32(4, buffer, true);
        headerView.setUint32(8, bufferSize, true);
        contractManager.writeMemory(this.id, BigInt(header), headerBuffer);

        // Write the values into the buffer
        const valuesBuffer = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
        contractManager.writeMemory(this.id, BigInt(buffer), valuesBuffer);

        await this.__unpin(buffer);
        return header;
    }

    private gasCallback(gas: bigint, method: string): void {
        this.params.gasCallback(gas, method);
    }

    private async getError(err: Error) {
        const msg = err.message;
        if (msg.includes('Execution aborted') && !msg.includes('Execution aborted:')) {
            return await this.abort();
        } else {
            return err;
        }
    }

    private async abort() {
        const abortData = contractManager.getAbortData(this.id);
        const message = this.__liftString(abortData.message);
        const fileName = this.__liftString(abortData.fileName);
        const line = abortData.line;
        const column = abortData.column;

        this.dispose();

        return new Error(`Execution aborted: ${message} at ${fileName}:${line}:${column}`);
    }

    private async __pin(pointer: number) {
        let finalResult;
        try {
            const resp = await contractManager.call(this.id, '__pin', [pointer]);
            this.gasCallback(resp.gasUsed, '__pin');

            const result = resp.result.filter((n) => n !== undefined);
            finalResult = result[0];
        } catch (e) {
            const error = e as Error;
            throw await this.getError(error);
        }

        return finalResult;
    }

    private async __unpin(pointer: number) {
        let finalResult;
        try {
            const resp = await contractManager.call(this.id, '__unpin', [pointer]);
            this.gasCallback(resp.gasUsed, '__unpin');

            const result = resp.result.filter((n) => n !== undefined);
            finalResult = result[0];
        } catch (e) {
            const error = e as Error;
            throw await this.getError(error);
        }

        return finalResult;
    }

    private async __new(size: number, align: number) {
        let finalResult;
        try {
            const resp = await contractManager.call(this.id, '__new', [size, align]);
            this.gasCallback(resp.gasUsed, '__new');

            const result = resp.result.filter((n) => n !== undefined);
            finalResult = result[0];
        } catch (e) {
            const error = e as Error;
            throw await this.getError(error);
        }

        return finalResult;
    }
}
