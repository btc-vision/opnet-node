export interface RustContractBinding {
    readonly id: bigint;
    readonly load: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly store: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly call: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly deployContractAtAddress: (data: Buffer) => Promise<Buffer | Uint8Array>;
    readonly log: (data: Buffer) => void;
    readonly emit: (data: Buffer) => void;
    readonly inputs: () => Promise<Buffer | Uint8Array>;
    readonly outputs: () => Promise<Buffer | Uint8Array>;
}
