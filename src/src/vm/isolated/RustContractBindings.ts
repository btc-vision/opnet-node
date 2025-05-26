import { AccountTypeResponse, BlockHashResponse } from '@btc-vision/op-vm';

export interface RustContractBinding {
    readonly id: bigint;
    readonly load: (data: Buffer) => Promise<Buffer | string>;
    readonly store: (data: Buffer) => Promise<Buffer | string>;
    readonly tLoad: (data: Buffer) => Promise<Buffer | string>;
    readonly tStore: (data: Buffer) => Promise<Buffer | string>;
    readonly call: (data: Buffer) => Promise<Buffer | string>;
    readonly deployContractAtAddress: (data: Buffer) => Promise<Buffer | string>;
    readonly log: (data: Buffer) => void;
    readonly emit: (data: Buffer) => void;
    readonly inputs: () => Promise<Buffer | string>;
    readonly outputs: () => Promise<Buffer | string>;
    readonly accountType: (data: Buffer) => Promise<AccountTypeResponse>;
    readonly blockHash: (blockNumber: bigint) => Promise<BlockHashResponse>;
}
