import { RustContractBinding } from './isolated/RustContractBindings.js';
import { ContractManager, ThreadSafeJsImportResponse } from '@btc-vision/op-vm';
import { Config } from '../config/Config.js';

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
            this.emitJSFunction,
            this.inputsJSFunction,
            this.outputsJSFunction,
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

    private logJSFunction: (_: never, result: ThreadSafeJsImportResponse) => Promise<void> = (
        _: never,
        value: ThreadSafeJsImportResponse,
    ): Promise<void> => {
        return new Promise((resolve) => {
            if (Config.DEV.ENABLE_CONTRACT_DEBUG) {
                const u = new Uint8Array(value.buffer);
                const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);

                const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
                if (!c) {
                    throw new Error('Binding not found');
                }

                c.log(buf);

                resolve();
            } else {
                throw new Error('Logging not enabled in production.');
            }
        });
    };

    private emitJSFunction: (_: never, result: ThreadSafeJsImportResponse) => Promise<void> = (
        _: never,
        value: ThreadSafeJsImportResponse,
    ): Promise<void> => {
        return new Promise<void>((resolve) => {
            const u = new Uint8Array(value.buffer);
            const buf = Buffer.from(u.buffer, u.byteOffset, u.byteLength);

            const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.

            if (!c) {
                throw new Error('Binding not found');
            }

            c.emit(buf);

            resolve();
        });
    };

    private inputsJSFunction: (
        _: never,
        result: ThreadSafeJsImportResponse,
    ) => Promise<Buffer | Uint8Array> = (
        _: never,
        value: ThreadSafeJsImportResponse,
    ): Promise<Buffer | Uint8Array> => {
        if (this.enableDebug) console.log('INPUTS', value);

        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
        if (!c) {
            throw new Error('Binding not found (inputs)');
        }

        return c.inputs();
    };

    private outputsJSFunction: (
        _: never,
        result: ThreadSafeJsImportResponse,
    ) => Promise<Buffer | Uint8Array> = (
        _: never,
        value: ThreadSafeJsImportResponse,
    ): Promise<Buffer | Uint8Array> => {
        if (this.enableDebug) console.log('OUTPUT', value);

        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
        if (!c) {
            throw new Error('Binding not found (outputs)');
        }

        return c.outputs();
    };

    // For future use?
    /*public cleanUp(): void {
        this.contractManager.destroyAll();
        this.contractManager.destroy();

        delete this._contractManager;
    }*/

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
            throw new Error('Binding not found (load)');
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
            throw new Error('Binding not found (store)');
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
            throw new Error('Binding not found (call)');
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
            throw new Error('Binding not found (deploy)');
        }

        return c.deployContractAtAddress(buf);
    };
}

export const Blockchain = new BlockchainBase();
