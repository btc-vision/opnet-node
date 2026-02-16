import { AccountTypeResponse, BlockHashResponse } from '@btc-vision/op-vm';

export interface RustContractBinding {
    readonly id: bigint;
    readonly loadMLDSA: (data: Uint8Array) => Promise<Buffer | Uint8Array>;
    readonly load: (data: Uint8Array) => Promise<Buffer | Uint8Array>;
    readonly store: (data: Uint8Array) => Promise<Buffer | Uint8Array>;
    readonly tLoad: (data: Uint8Array) => Promise<Buffer | Uint8Array>;
    readonly tStore: (data: Uint8Array) => Promise<Buffer | Uint8Array>;
    readonly call: (data: Uint8Array) => Promise<Buffer | Uint8Array>;
    readonly deployContractAtAddress: (data: Uint8Array) => Promise<Buffer | Uint8Array>;
    readonly updateFromAddress: (data: Uint8Array) => Promise<Buffer | Uint8Array>;
    readonly log: (data: Uint8Array) => void;
    readonly emit: (data: Uint8Array) => void;
    readonly inputs: () => Promise<Buffer | Uint8Array>;
    readonly outputs: () => Promise<Buffer | Uint8Array>;
    readonly accountType: (data: Uint8Array) => Promise<AccountTypeResponse>;
    readonly blockHash: (blockNumber: bigint) => Promise<BlockHashResponse>;
}
