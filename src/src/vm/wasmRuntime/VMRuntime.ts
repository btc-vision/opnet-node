export interface VMRuntime {
    readMethod(method: number, data: Uint8Array): Promise<Uint8Array>;

    readView(method: number): Promise<Uint8Array>;

    defineSelectors(): Promise<void>;

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

    setGasUsed(maxGas: bigint, currentGasUsage: bigint, initialGas: bigint): void;
    
    instantiate(): Promise<void>;
}

export interface ExtendedIsolator extends Omit<VMRuntime, 'setGasUsed'> {
    garbageCollector(): Promise<void>;

    dispose(): void;

    setUsedGas(usedGas: bigint): void;
}
