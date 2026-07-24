import { RustContractBinding } from './rust/RustContractBindings.js';
import {
    AccountTypeResponse,
    BitcoinNetworkRequest,
    BlockHashRequest,
    BlockHashResponse,
    ContractManager,
    ThreadSafeJsImportResponse,
} from '@btc-vision/op-vm';
import { Config } from '../config/Config.js';
import { OPVMVersion } from './rust/versions/OPVMVersion.js';

/**
 * The host functions a ContractManager is constructed with. They are plain JS
 * closures over one runtime's binding table, so every version gets its own set.
 */
export interface OPVMHostFunctions {
    readonly load: (_: never, result: ThreadSafeJsImportResponse) => Promise<Buffer | Uint8Array>;
    readonly store: (_: never, result: ThreadSafeJsImportResponse) => Promise<Buffer | Uint8Array>;
    readonly call: (_: never, result: ThreadSafeJsImportResponse) => Promise<Buffer | Uint8Array>;
    readonly deployContractAtAddress: (
        _: never,
        result: ThreadSafeJsImportResponse,
    ) => Promise<Buffer | Uint8Array>;
    readonly updateFromAddress: (
        _: never,
        result: ThreadSafeJsImportResponse,
    ) => Promise<Buffer | Uint8Array>;
    readonly log: (_: never, result: ThreadSafeJsImportResponse) => Promise<void>;
    readonly emit: (_: never, result: ThreadSafeJsImportResponse) => Promise<void>;
    readonly inputs: (id: bigint) => Promise<Buffer | Uint8Array>;
    readonly outputs: (id: bigint) => Promise<Buffer | Uint8Array>;
    readonly accountType: (
        _: never,
        result: ThreadSafeJsImportResponse,
    ) => Promise<AccountTypeResponse>;
    readonly blockHash: (_: never, result: BlockHashRequest) => Promise<BlockHashResponse>;
    readonly loadMLDSA: (
        _: never,
        result: ThreadSafeJsImportResponse,
    ) => Promise<Buffer | Uint8Array>;
}

/** Everything RustContract needs to instantiate a contract, version-agnostic. */
export interface InstantiateArgs {
    readonly reservedId: bigint;
    readonly address: string;
    readonly bytecode: Buffer;
    readonly gasUsed: bigint;
    readonly gasMax: bigint;
    readonly memoryPagesUsed: bigint;
    readonly network: BitcoinNetworkRequest;
    readonly isDebugMode: boolean;
}

/**
 * Every manager operation except `instantiate`. Derived from the package's own
 * public class rather than restated, so it tracks op-vm automatically.
 * `instantiate` is excluded because its signature is the one thing that differs
 * between builds: 1.1.0 added a hard fork descriptor that 1.0.0 has no concept
 * of. Each adapter therefore owns its own instantiate call.
 */
export type OPVMContractManager = Omit<ContractManager, 'instantiate'>;

export interface OPVMBackend {
    readonly manager: OPVMContractManager;
    readonly instantiate: (args: InstantiateArgs) => void;
}

export type BackendFactory = (host: OPVMHostFunctions) => OPVMBackend;

/**
 * One op-vm build, with its own ContractManager and its own binding table.
 *
 * The binding table MUST NOT be shared between versions. Contract ids come from
 * `contractManager.reserveId()`, and each manager counts independently, so two
 * managers hand out the same ids. A shared table would route one contract's
 * storage callbacks to another contract's evaluation.
 */
export class OPVMRuntime {
    public readonly version: OPVMVersion;

    private readonly bindings: Map<bigint, RustContractBinding> = new Map<
        bigint,
        RustContractBinding
    >();

    private readonly enableDebug: boolean = false;

    private readonly backendFactory: BackendFactory;

    public constructor(version: OPVMVersion, backendFactory: BackendFactory) {
        this.version = version;
        this.backendFactory = backendFactory;
    }

    private _backend?: OPVMBackend;

    private get backend(): OPVMBackend {
        if (!this._backend) {
            this.createManager();
        }

        if (!this._backend) {
            throw new Error(`Contract manager not initialized for ${this.version}`);
        }

        return this._backend;
    }

    public get contractManager(): OPVMContractManager {
        return this.backend.manager;
    }

    /** True once this runtime has loaded its native module and built a manager. */
    public get initialized(): boolean {
        return this._backend !== undefined;
    }

    public createManager(): void {
        this._backend = this.backendFactory(this.hostFunctions);
    }

    /** Route instantiation through the version's own call shape. */
    public instantiateContract(args: InstantiateArgs): void {
        this.backend.instantiate(args);
    }

    public purgeCached(): void {
        if (!this.initialized) return;

        this.contractManager.destroyCache();
    }

    public removeBinding(id: bigint): void {
        this.bindings.delete(id);
    }

    public registerBinding(binding: RustContractBinding): void {
        this.bindings.set(binding.id, binding);
    }

    public purge(): void {
        if (this.initialized) {
            this.contractManager.destroyAll();
        }

        this.bindings.clear();
    }

    private binding(contractId: bigint | string | number, context: string): RustContractBinding {
        const c = this.bindings.get(BigInt(`${contractId}`)); // otherwise unsafe.
        if (!c) {
            throw new Error(`Binding not found (${context})`);
        }

        return c;
    }

    private blockHashJSFunction: (
        _: never,
        result: BlockHashRequest,
    ) => Promise<BlockHashResponse> = (
        _: never,
        value: BlockHashRequest,
    ): Promise<BlockHashResponse> => {
        if (this.enableDebug) console.log('BLOCK HASH', value.blockNumber);

        return this.binding(value.contractId, 'blockHash').blockHash(value.blockNumber);
    };

    private accountTypeJSFunction: (
        _: never,
        result: ThreadSafeJsImportResponse,
    ) => Promise<AccountTypeResponse> = (
        _: never,
        value: ThreadSafeJsImportResponse,
    ): Promise<AccountTypeResponse> => {
        if (this.enableDebug) console.log('ACCOUNT TYPE', value.buffer);

        const buf = new Uint8Array(value.buffer);

        return this.binding(value.contractId, 'accountType').accountType(buf);
    };

    private logJSFunction: (_: never, result: ThreadSafeJsImportResponse) => Promise<void> = (
        _: never,
        value: ThreadSafeJsImportResponse,
    ): Promise<void> => {
        return new Promise((resolve) => {
            if (Config.DEV.ENABLE_CONTRACT_DEBUG) {
                const buf = new Uint8Array(value.buffer);

                this.binding(value.contractId, 'log').log(buf);

                resolve();
            } else {
                resolve();
            }
        });
    };

    private emitJSFunction: (_: never, result: ThreadSafeJsImportResponse) => Promise<void> = (
        _: never,
        value: ThreadSafeJsImportResponse,
    ): Promise<void> => {
        return new Promise<void>((resolve) => {
            const buf = new Uint8Array(value.buffer);

            this.binding(value.contractId, 'emit').emit(buf);

            resolve();
        });
    };

    private inputsJSFunction: (id: bigint) => Promise<Buffer | Uint8Array> = (
        id: bigint,
    ): Promise<Buffer | Uint8Array> => {
        if (this.enableDebug) console.log('INPUTS', id);

        return this.binding(id, 'inputs').inputs();
    };

    private outputsJSFunction: (id: bigint) => Promise<Buffer | Uint8Array> = (
        id: bigint,
    ): Promise<Buffer | Uint8Array> => {
        if (this.enableDebug) console.log('OUTPUT', id);

        return this.binding(id, 'outputs').outputs();
    };

    private loadMLDSAJsFunction: (
        _: never,
        result: ThreadSafeJsImportResponse,
    ) => Promise<Buffer | Uint8Array> = (
        _: never,
        value: ThreadSafeJsImportResponse,
    ): Promise<Buffer | Uint8Array> => {
        if (this.enableDebug) console.log('LOAD MLDSA', value.buffer);

        const u = new Uint8Array(value.buffer);
        const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);

        return this.binding(value.contractId, 'loadMLDSA').loadMLDSA(buf);
    };

    private loadJsFunction: (
        _: never,
        result: ThreadSafeJsImportResponse,
    ) => Promise<Buffer | Uint8Array> = (
        _: never,
        value: ThreadSafeJsImportResponse,
    ): Promise<Buffer | Uint8Array> => {
        if (this.enableDebug) console.log('LOAD', value.buffer);

        const buf = new Uint8Array(value.buffer);

        return this.binding(value.contractId, 'load').load(buf);
    };

    private storeJSFunction: (
        _: never,
        result: ThreadSafeJsImportResponse,
    ) => Promise<Buffer | Uint8Array> = (
        _: never,
        value: ThreadSafeJsImportResponse,
    ): Promise<Buffer | Uint8Array> => {
        if (this.enableDebug) console.log('STORE', value.buffer);

        const buf = new Uint8Array(value.buffer);

        return this.binding(value.contractId, 'store').store(buf);
    };

    private callJSFunction: (
        _: never,
        result: ThreadSafeJsImportResponse,
    ) => Promise<Buffer | Uint8Array> = (
        _: never,
        value: ThreadSafeJsImportResponse,
    ): Promise<Buffer | Uint8Array> => {
        if (this.enableDebug) console.log('CALL', value.buffer);

        const buf = new Uint8Array(value.buffer);

        return this.binding(value.contractId, 'call').call(buf);
    };

    private deployContractAtAddressJSFunction: (
        _: never,
        result: ThreadSafeJsImportResponse,
    ) => Promise<Buffer | Uint8Array> = (
        _: never,
        value: ThreadSafeJsImportResponse,
    ): Promise<Buffer | Uint8Array> => {
        if (this.enableDebug) console.log('DEPLOY', value.buffer);

        const buf = new Uint8Array(value.buffer);

        return this.binding(value.contractId, 'deploy').deployContractAtAddress(buf);
    };

    private updateFromAddressJSFunction: (
        _: never,
        result: ThreadSafeJsImportResponse,
    ) => Promise<Buffer | Uint8Array> = (
        _: never,
        value: ThreadSafeJsImportResponse,
    ): Promise<Buffer | Uint8Array> => {
        if (this.enableDebug) console.log('DEPLOY', value.buffer);

        const buf = new Uint8Array(value.buffer);

        return this.binding(value.contractId, 'update').updateFromAddress(buf);
    };

    private get hostFunctions(): OPVMHostFunctions {
        return {
            load: this.loadJsFunction,
            store: this.storeJSFunction,
            call: this.callJSFunction,
            deployContractAtAddress: this.deployContractAtAddressJSFunction,
            updateFromAddress: this.updateFromAddressJSFunction,
            log: this.logJSFunction,
            emit: this.emitJSFunction,
            inputs: this.inputsJSFunction,
            outputs: this.outputsJSFunction,
            accountType: this.accountTypeJSFunction,
            blockHash: this.blockHashJSFunction,
            loadMLDSA: this.loadMLDSAJsFunction,
        };
    }
}
