import { Selector } from '@btc-vision/bsi-binary';

export type VMRuntime = {
    getContract(): Promise<Number>;

    readMethod(
        method: Selector,
        contract: Number | null,
        calldata: Uint8Array,
    ): Promise<Uint8Array>;

    readView(method: Selector, contract?: Number | null): Promise<Uint8Array>;

    getViewABI(): Promise<Uint8Array>;
    getEvents(): Promise<Uint8Array>;
    getMethodABI(): Promise<Uint8Array>;
    getWriteMethods(): Promise<Uint8Array>;

    getModifiedStorage(): Promise<Uint8Array>;
    initializeStorage(): Promise<Uint8Array>;

    loadStorage(data: Uint8Array): Promise<void>;
    loadCallsResponse(data: Uint8Array): Promise<void>;

    getCalls(): Promise<Uint8Array>;
    setEnvironment(environment: Uint8Array): Promise<void>;

    setMaxGas(maxGas: bigint, currentGasUsage: bigint, initialGas: bigint): Promise<void>;
    purgeMemory(): Promise<void>;
};
