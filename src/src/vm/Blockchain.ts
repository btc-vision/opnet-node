import { RustContractBinding } from './isolated/RustContractBindings.js';
import {
    AccountTypeResponse,
    BlockHashRequest,
    BlockHashResponse,
    ContractManager,
    ThreadSafeJsImportResponse,
} from '@btc-vision/op-vm';

// https://github.com/nodejs/node/issues/55706#issuecomment-2907895374
export const ENABLE_BUFFER_AS_STRING: boolean = false;

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

    private decodeBuffer(input: number[] | string): Uint8Array {
        if (ENABLE_BUFFER_AS_STRING) {
            if (typeof input !== 'string') {
                throw new Error('Input is not a string');
            }

            return Buffer.from(input, 'hex');
        } else {
            if (typeof input === 'string') {
                throw new Error('Input is a string');
            } else {
                return new Uint8Array(input);
            }
        }
    }

    private loadJsFunction: (
        err: Error,
        result: ThreadSafeJsImportResponse,
    ) => Promise<Uint8Array | string> = (
        err: Error,
        value: ThreadSafeJsImportResponse,
    ): Promise<Uint8Array | string> => {
        if (err) throw new Error(`Fatal error: ${err?.message}`);
        if (this.enableDebug) console.log('LOAD', value);

        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
        if (!c) {
            throw new Error('Binding not found');
        }

        return c.load(this.decodeBuffer(value.buffer));
    };

    private storeJSFunction: (
        err: Error,
        result: ThreadSafeJsImportResponse,
    ) => Promise<Uint8Array | string> = (
        err: Error,
        value: ThreadSafeJsImportResponse,
    ): Promise<Uint8Array | string> => {
        if (err) throw new Error(`Fatal error: ${err?.message}`);
        if (this.enableDebug) console.log('STORE', value);

        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
        if (!c) {
            throw new Error('Binding not found');
        }

        return c.store(this.decodeBuffer(value.buffer));
    };

    private callJSFunction: (
        err: Error,
        result: ThreadSafeJsImportResponse,
    ) => Promise<Uint8Array | string> = (
        err: Error,
        value: ThreadSafeJsImportResponse,
    ): Promise<Uint8Array | string> => {
        if (err) throw new Error(`Fatal error: ${err?.message}`);
        if (this.enableDebug) console.log('CALL', value);

        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
        if (!c) {
            throw new Error('Binding not found');
        }

        return c.call(this.decodeBuffer(value.buffer));
    };

    private deployContractAtAddressJSFunction: (
        err: Error,
        result: ThreadSafeJsImportResponse,
    ) => Promise<Uint8Array | string> = (
        err: Error,
        value: ThreadSafeJsImportResponse,
    ): Promise<Uint8Array | string> => {
        if (err) throw new Error(`Fatal error: ${err?.message}`);
        if (this.enableDebug) console.log('DEPLOY', value);

        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
        if (!c) {
            throw new Error('Binding not found');
        }

        return c.deployContractAtAddress(this.decodeBuffer(value.buffer));
    };

    private logJSFunction: (err: Error, result: ThreadSafeJsImportResponse) => Promise<undefined> =
        (err: Error, value: ThreadSafeJsImportResponse): Promise<undefined> => {
            return new Promise((resolve) => {
                if (this.enableDebug) console.log('LOG', value);
                if (err) throw new Error(`Fatal error: ${err?.message}`);

                const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
                if (!c) {
                    throw new Error('Binding not found');
                }

                c.log(this.decodeBuffer(value.buffer));

                resolve(undefined);
            });
        };

    private emitJSFunction: (err: Error, result: ThreadSafeJsImportResponse) => Promise<undefined> =
        (err: Error, value: ThreadSafeJsImportResponse): Promise<undefined> => {
            return new Promise<undefined>((resolve) => {
                if (this.enableDebug) console.log('EMIT', value);
                if (err) throw new Error(`Fatal error: ${err?.message}`);

                const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
                if (!c) {
                    throw new Error('Binding not found');
                }

                c.emit(this.decodeBuffer(value.buffer));

                resolve(undefined);
            });
        };

    private inputsJSFunction: (
        err: Error,
        result: ThreadSafeJsImportResponse,
    ) => Promise<Uint8Array | string> = (
        err: Error,
        value: ThreadSafeJsImportResponse,
    ): Promise<Uint8Array | string> => {
        if (err) throw new Error(`Fatal error: ${err?.message}`);
        if (this.enableDebug) console.log('INPUTS', value);

        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
        if (!c) {
            throw new Error('Binding not found');
        }

        return c.inputs();
    };

    private outputsJSFunction: (
        err: Error,
        result: ThreadSafeJsImportResponse,
    ) => Promise<Uint8Array | string> = (
        err: Error,
        value: ThreadSafeJsImportResponse,
    ): Promise<Uint8Array | string> => {
        if (err) throw new Error(`Fatal error: ${err?.message}`);
        if (this.enableDebug) console.log('OUTPUT', value);

        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
        if (!c) {
            throw new Error('Binding not found');
        }

        return c.outputs();
    };

    private accountTypeJSFunction: (
        err: Error,
        result: ThreadSafeJsImportResponse,
    ) => Promise<AccountTypeResponse> = (
        err: Error,
        value: ThreadSafeJsImportResponse,
    ): Promise<AccountTypeResponse> => {
        if (err) throw new Error(`Fatal error: ${err?.message}`);
        if (this.enableDebug) console.log('ACCOUNT TYPE', value);

        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.
        if (!c) {
            throw new Error('Binding not found');
        }

        return c.accountType(this.decodeBuffer(value.buffer));
    };

    private blockHashJSFunction: (
        err: Error,
        result: BlockHashRequest,
    ) => Promise<BlockHashResponse> = (
        err: Error,
        value: BlockHashRequest,
    ): Promise<BlockHashResponse> => {
        if (err) throw new Error(`Fatal error: ${err?.message}`);
        if (this.enableDebug) console.log('BLOCK HASH', value);

        const c = this.bindings.get(BigInt(`${value.contractId}`)); // otherwise unsafe.

        if (!c) {
            throw new Error('Binding not found');
        }

        return c.blockHash(value.blockNumber);
    };
}

export const Blockchain = new BlockchainBase();
