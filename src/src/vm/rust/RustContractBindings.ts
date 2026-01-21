import { AccountTypeResponse, BlockHashResponse } from '@btc-vision/op-vm';

export interface RustContractBinding {
    readonly id: bigint;
    readonly loadMLDSA: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly load: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly store: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly tLoad: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly tStore: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly call: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly deployContractAtAddress: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly updateFromAddress: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly log: (data: Buffer) => void;
    readonly emit: (data: Buffer) => void;
    readonly inputs: () => Promise<Buffer | Uint8Array>;
    readonly outputs: () => Promise<Buffer | Uint8Array>;
    readonly accountType: (data: Buffer) => Promise<AccountTypeResponse>;
    readonly blockHash: (blockNumber: bigint) => Promise<BlockHashResponse>;
}
