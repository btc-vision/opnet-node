import { BitcoinNetworkRequest, Contract } from '@btc-vision/bsi-wasmer-vm';

export interface ContractParameters {
    readonly bytecode: Buffer;
    readonly gasLimit: bigint;
    readonly network: BitcoinNetworkRequest;
    readonly gasCallback: (gas: bigint, method: string) => void;

    readonly load: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly store: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly call: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly deployContractAtAddress: (data: Buffer) => Promise<Buffer | Uint8Array>;
    //readonly encodeAddress: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly log: (data: Buffer) => void;
}

export interface VMContract {
    readMethod(method: number, data: Uint8Array): Promise<Uint8Array>;

    readView(method: number): Promise<Uint8Array>;

    defineSelectors(): Promise<void>;

    getViewABI(): Promise<Uint8Array>;

    getEvents(): Promise<Uint8Array>;

    getMethodABI(): Promise<Uint8Array>;

    getWriteMethods(): Promise<Uint8Array>;

    setEnvironment(environment: Uint8Array): Promise<void>;

    setGasUsed(maxGas: bigint, currentGasUsage: bigint, initialGas: bigint): void;

    instantiate(): Promise<void>;
}

export type VMRuntime = Contract & VMContract;

export interface ExportedContract extends Omit<VMRuntime, 'setGasUsed'> {
    garbageCollector(): Promise<void>;

    dispose(): void;

    setUsedGas(usedGas: bigint): void;

    setGasCallback(callback: (gas: bigint, method: string) => void): void;
}


export declare function loadRust(contractParameters: ContractParameters): Promise<ExportedContract>;
