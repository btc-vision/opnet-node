import { RustContractBinding } from './isolated/RustContractBindings.js';
import { ContractManager, ThreadSafeJsImportResponse } from '../../../../bsi-wasmer-vm/index.js';

class BlockchainBase {
    private readonly bindings: Map<bigint, RustContractBinding> = new Map<
        bigint,
        RustContractBinding
    >();

    private readonly enableDebug: boolean = false;

    private _contractManager?: ContractManager;

    public get contractManager(): ContractManager {
        if (!this._contractManager) {
            this.createManager();
        }

        if (!this._contractManager) {
            throw new Error('Contract manager not initialized');
        }

        return this._contractManager;
    }

    public createManager(): void {
        this._contractManager = new ContractManager(
            16, // max idling runtime
            this.loadJsFunction,
            this.storeJSFunction,
            this.callJSFunction,
            this.deployContractAtAddressJSFunction,
            this.logJSFunction,
        );
    }

    public purgeCached(): void {
        this.contractManager.destroyCache();
    }

    public removeBinding(id: bigint): void {
        this.bindings.delete(id);
    }

    public registerBinding(binding: RustContractBinding): void {
        this.bindings.set(binding.id, binding);
    }

    public purge(): void {
        this.contractManager.destroyAll();

        this.bindings.clear();
    }

    public cleanUp(): void {
        this.contractManager.destroyAll();
        this.contractManager.destroy();

        delete this._contractManager;
    }

    private loadJsFunction: (
        _: never,
        result: ThreadSafeJsImportResponse,
    ) => Promise<Buffer | Uint8Array> = (
        _: never,
        value: ThreadSafeJsImportResponse,
    ): Promise<Buffer | Uint8Array> => {
        if (this.enableDebug) console.log('LOAD', value.buffer);

        const u = new Uint8Array(value.buffer);
        const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);
        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.

        if (!c) {
            throw new Error('Binding not found');
        }

        return c.load(buf);
    };

    private storeJSFunction: (
        _: never,
        result: ThreadSafeJsImportResponse,
    ) => Promise<Buffer | Uint8Array> = (
        _: never,
        value: ThreadSafeJsImportResponse,
    ): Promise<Buffer | Uint8Array> => {
        if (this.enableDebug) console.log('STORE', value.buffer);

        const u = new Uint8Array(value.buffer);
        const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);

        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.

        if (!c) {
            throw new Error('Binding not found');
        }

        return c.store(buf);
    };

    private callJSFunction: (
        _: never,
        result: ThreadSafeJsImportResponse,
    ) => Promise<Buffer | Uint8Array> = (
        _: never,
        value: ThreadSafeJsImportResponse,
    ): Promise<Buffer | Uint8Array> => {
        if (this.enableDebug) console.log('CALL', value.buffer);

        const u = new Uint8Array(value.buffer);
        const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);

        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.

        if (!c) {
            throw new Error('Binding not found');
        }

        return c.call(buf);
    };

    private deployContractAtAddressJSFunction: (
        _: never,
        result: ThreadSafeJsImportResponse,
    ) => Promise<Buffer | Uint8Array> = (
        _: never,
        value: ThreadSafeJsImportResponse,
    ): Promise<Buffer | Uint8Array> => {
        if (this.enableDebug) console.log('DEPLOY', value.buffer);

        const u = new Uint8Array(value.buffer);
        const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);

        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.

        if (!c) {
            throw new Error('Binding not found');
        }

        return c.deployContractAtAddress(buf);
    };

    private logJSFunction: (_: never, result: ThreadSafeJsImportResponse) => Promise<void> = (
        _: never,
        value: ThreadSafeJsImportResponse,
    ): Promise<void> => {
        return new Promise<void>(() => {
            // temporary
            const u = new Uint8Array(value.buffer);
            const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);

            const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.

            if (!c) {
                throw new Error('Binding not found');
            }

            return c.log(buf);
        });
    };
}

export const Blockchain = new BlockchainBase();
