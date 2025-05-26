import { AccountTypeResponse, BlockHashResponse } from '@btc-vision/op-vm';

export interface RustContractBinding {
    readonly id: bigint;
    readonly load: (data: Uint8Array) => Promise<Uint8Array | string>;
    readonly store: (data: Uint8Array) => Promise<Uint8Array | string>;
    readonly tLoad: (data: Uint8Array) => Promise<Uint8Array | string>;
    readonly tStore: (data: Uint8Array) => Promise<Uint8Array | string>;
    readonly call: (data: Uint8Array) => Promise<Uint8Array | string>;
    readonly deployContractAtAddress: (data: Uint8Array) => Promise<Uint8Array | string>;
    readonly log: (data: Uint8Array) => void;
    readonly emit: (data: Uint8Array) => void;
    readonly inputs: () => Promise<Uint8Array | string>;
    readonly outputs: () => Promise<Uint8Array | string>;
    readonly accountType: (data: Uint8Array) => Promise<AccountTypeResponse>;
    readonly blockHash: (blockNumber: bigint) => Promise<BlockHashResponse>;
}
