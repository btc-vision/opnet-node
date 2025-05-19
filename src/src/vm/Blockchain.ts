import { RustContractBinding } from './isolated/RustContractBindings.js';
import {
    AccountTypeResponse,
    BlockHashRequest,
    ContractManager,
    ThreadSafeJsImportResponse,
} from '@btc-vision/op-vm';
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
            this.accountTypeJSFunction,
            this.blockHashJSFunction,
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

    private blockHashJSFunction: (
        err: Error,
        result: BlockHashRequest,
    ) => Promise<Buffer | Uint8Array> = (
        err: Error,
        value: BlockHashRequest,
    ): Promise<Buffer | Uint8Array> => {
        if (err) throw new Error(`Fatal error: ${err}`);
        if (this.enableDebug) console.log('BLOCK HASH', value.blockNumber);

        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
        if (!c) {
            throw new Error('Binding not found');
        }

        return c.blockHash(value.blockNumber);
    };

    private accountTypeJSFunction: (
        err: Error,
        result: ThreadSafeJsImportResponse,
    ) => Promise<AccountTypeResponse> = (
        err: Error,
        value: ThreadSafeJsImportResponse,
    ): Promise<AccountTypeResponse> => {
        if (err) throw new Error(`Fatal error: ${err}`);
        if (this.enableDebug) console.log('ACCOUNT TYPE', value.buffer);

        const buf = Buffer.from(Array.from(value.buffer));
        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
        if (!c) {
            throw new Error('Binding not found');
        }

        return c.accountType(buf);
    };

    private logJSFunction: (err: Error, result: ThreadSafeJsImportResponse) => Promise<void> = (
        err: Error,
        value: ThreadSafeJsImportResponse,
    ): Promise<void> => {
        return new Promise((resolve) => {
            if (err) throw new Error(`Fatal error: ${err}`);

            if (Config.DEV.ENABLE_CONTRACT_DEBUG) {
                const buf = Buffer.from(Array.from(value.buffer));
                const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
                if (!c) {
                    throw new Error('Binding not found');
                }

                c.log(buf);

                resolve();
            } else {
                resolve();
            }
        });
    };

    private emitJSFunction: (err: Error, result: ThreadSafeJsImportResponse) => Promise<void> = (
        err: Error,
        value: ThreadSafeJsImportResponse,
    ): Promise<void> => {
        return new Promise<void>((resolve) => {
            if (err) throw new Error(`Fatal error: ${err}`);

            const buf = Buffer.from(Array.from(value.buffer));
            const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
            if (!c) {
                throw new Error('Binding not found');
            }

            c.emit(buf);

            resolve();
        });
    };

    private inputsJSFunction: (err: Error, result: ThreadSafeJsImportResponse) => Promise<Buffer> =
        (err: Error, value: ThreadSafeJsImportResponse): Promise<Buffer> => {
            if (err) throw new Error(`Fatal error: ${err}`);
            if (this.enableDebug) console.log('INPUTS', value);

            const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
            if (!c) {
                throw new Error('Binding not found (inputs)');
            }

            return c.inputs();
        };

    private outputsJSFunction: (err: Error, result: ThreadSafeJsImportResponse) => Promise<Buffer> =
        (err: Error, value: ThreadSafeJsImportResponse): Promise<Buffer> => {
            if (err) throw new Error(`Fatal error: ${err}`);
            if (this.enableDebug) console.log('OUTPUT', value);

            const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
            if (!c) {
                throw new Error('Binding not found (outputs)');
            }

            return c.outputs();
        };

    private loadJsFunction: (err: Error, result: ThreadSafeJsImportResponse) => Promise<Buffer> = (
        err: Error,
        value: ThreadSafeJsImportResponse,
    ): Promise<Buffer> => {
        if (err) throw new Error(`Fatal error: ${err}`);
        if (this.enableDebug) console.log('LOAD', value.buffer);

        const buf = Buffer.from(Array.from(value.buffer));
        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
        if (!c) {
            throw new Error('Binding not found (load)');
        }

        return c.load(buf);
    };

    private storeJSFunction: (err: Error, result: ThreadSafeJsImportResponse) => Promise<Buffer> = (
        err: Error,
        value: ThreadSafeJsImportResponse,
    ): Promise<Buffer> => {
        if (err) throw new Error(`Fatal error: ${err}`);
        if (this.enableDebug) console.log('STORE', value.buffer);

        const buf = Buffer.from(Array.from(value.buffer));
        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
        if (!c) {
            throw new Error('Binding not found (store)');
        }

        return c.store(buf);
    };

    private callJSFunction: (err: Error, result: ThreadSafeJsImportResponse) => Promise<Buffer> = (
        err: Error,
        value: ThreadSafeJsImportResponse,
    ): Promise<Buffer> => {
        if (err) throw new Error(`Fatal error: ${err}`);
        if (this.enableDebug) console.log('CALL', value.buffer);

        const buf = Buffer.from(Array.from(value.buffer));
        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
        if (!c) {
            throw new Error('Binding not found (call)');
        }

        return c.call(buf);
    };

    private deployContractAtAddressJSFunction: (
        err: Error,
        result: ThreadSafeJsImportResponse,
    ) => Promise<Buffer> = (err: Error, value: ThreadSafeJsImportResponse): Promise<Buffer> => {
        if (err) throw new Error(`Fatal error: ${err}`);
        if (this.enableDebug) console.log('DEPLOY', value.buffer);

        const buf = Buffer.from(Array.from(value.buffer));
        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
        if (!c) {
            throw new Error('Binding not found (deploy)');
        }

        return c.deployContractAtAddress(buf);
    };
}

export const Blockchain = new BlockchainBase();
