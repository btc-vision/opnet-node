import { MeterType, meterWASM } from '@btc-vision/wasm-metering';
import fs from 'fs';
import IsolatedVM from 'isolated-vm';
import ivm, { Context, Isolate, Reference, ReferenceApplyOptions } from 'isolated-vm';
import path from 'path';

import { ContractEvaluator } from './runtime/ContractEvaluator.js';
import { MemoryValue } from './storage/types/MemoryValue.js';
import { StoragePointer } from './storage/types/StoragePointer.js';
import { VMRuntime } from './wasmRuntime/runDebug.js';

interface IsolatedMethods {
    INIT_METHOD: IsolatedVM.Reference<VMRuntime['INIT']>;
    GET_CONTRACT_METHOD: IsolatedVM.Reference<VMRuntime['getContract']>;
    GET_REQUIRED_STORAGE: IsolatedVM.Reference<VMRuntime['getRequiredStorage']>;
    LOAD_STORAGE: IsolatedVM.Reference<VMRuntime['loadStorage']>;
    GET_MODIFIED_STORAGE: IsolatedVM.Reference<VMRuntime['getModifiedStorage']>;
    READ_METHOD: IsolatedVM.Reference<VMRuntime['readMethod']>;
    READ_VIEW: IsolatedVM.Reference<VMRuntime['readView']>;
    GET_VIEW_ABI: IsolatedVM.Reference<VMRuntime['getViewABI']>;
    GET_WRITE_METHODS: IsolatedVM.Reference<VMRuntime['getWriteMethods']>;
    GET_METHOD_ABI: IsolatedVM.Reference<VMRuntime['getMethodABI']>;
    ALLOCATE_MEMORY: IsolatedVM.Reference<VMRuntime['allocateMemory']>;
    INITIALIZE_STORAGE: IsolatedVM.Reference<VMRuntime['initializeStorage']>;
    IS_INITIALIZED: IsolatedVM.Reference<VMRuntime['isInitialized']>;
    GET_EVENTS: IsolatedVM.Reference<VMRuntime['getEvents']>;
    PURGE_MEMORY: IsolatedVM.Reference<VMRuntime['purgeMemory']>;
    SET_MAX_GAS: IsolatedVM.Reference<VMRuntime['setMaxGas']>;
}

const codePath = path.resolve(__dirname, '../vm/isolated/IsolatedManager.js');
const code: string = fs.readFileSync(codePath, 'utf-8');

export class VMIsolator {
    public static readonly MAX_GAS: bigint = 666666666666n; //100000000000n; // Default gas limit
    private static readonly EXECUTION_TIMEOUT: number = 400000; //60 * 60000; // 1h

    private contract: ContractEvaluator | null = null;
    private isolatedVM: Isolate = this.createVM();
    private context: Context = this.createContext();

    private jail = this.context.global;

    private module: ivm.Module | null = null;
    private reference: ivm.Reference<VMRuntime> | null = null;

    private methods: IsolatedMethods | null = null;

    constructor(
        public readonly contractAddress: string,
        private readonly contractBytecode: Buffer,
    ) {}

    public onGasUsed: (gas: bigint) => void = () => {};

    public getStorage(
        _address: string,
        _pointer: StoragePointer,
        _defaultValue: MemoryValue | null,
        _setIfNotExit: boolean,
    ): Promise<MemoryValue | null> {
        throw new Error('Method not implemented. [getStorage]');
    }

    public setStorage(
        _address: string,
        _pointer: StoragePointer,
        _value: MemoryValue,
    ): Promise<void> {
        throw new Error('Method not implemented. [setStorage]');
    }

    public getContract(): ContractEvaluator | null {
        if (!this.contract) {
            throw new Error('Contract not loaded');
        }

        return this.contract;
    }

    /**
     * VERY IMPORTANT.
     * This method is used to reset the VM if something goes wrong.
     */
    public async reset(): Promise<boolean> {
        this.dispose();

        this.isolatedVM = this.createVM();
        this.context = this.createContext();

        this.jail = this.context.global;

        return await this.setupJail();
    }

    public async setupJail(): Promise<boolean> {
        this.jail.setSync('global', this.jail.derefInto());
        this.jail.setSync('globalThis', this.jail.derefInto());

        this.jail.setSync('log', function (...args: unknown[]): void {
            console.log(...args);
        });

        this.jail.setSync('gasCallback', (gas: bigint): void => {
            this.onGasUsed(gas);
        });

        this.jail.setSync('MAX_GAS', VMIsolator.MAX_GAS);

        let errored = await this.loadContractFromBytecode();
        if (errored) {
            return errored;
        }

        this.defineMethods();

        this.contract = new ContractEvaluator(this);

        const runTime: VMRuntime = this.getRuntime();
        await this.contract.init(runTime);

        return false;
    }

    public dispose(): void {
        this.methods = null;
        this.module = null;

        this.context.release();

        this.isolatedVM.dispose();
    }

    private createVM(): Isolate {
        return new ivm.Isolate({ memoryLimit: 128 });
    }

    private createContext(): Context {
        return this.isolatedVM.createContextSync();
    }

    private defineMethods(): void {
        if (!this.reference) {
            throw new Error('Contract not loaded');
        }

        this.methods = {
            INIT_METHOD: this.reference.getSync('INIT', { reference: true }),
            GET_CONTRACT_METHOD: this.reference.getSync('getContract', { reference: true }),
            READ_METHOD: this.reference.getSync('readMethod', { reference: true }),
            READ_VIEW: this.reference.getSync('readView', { reference: true }),
            GET_VIEW_ABI: this.reference.getSync('getViewABI', { reference: true }),
            GET_EVENTS: this.reference.getSync('getEvents', { reference: true }),
            GET_METHOD_ABI: this.reference.getSync('getMethodABI', { reference: true }),
            GET_WRITE_METHODS: this.reference.getSync('getWriteMethods', { reference: true }),
            GET_REQUIRED_STORAGE: this.reference.getSync('getRequiredStorage', { reference: true }),
            GET_MODIFIED_STORAGE: this.reference.getSync('getModifiedStorage', { reference: true }),
            INITIALIZE_STORAGE: this.reference.getSync('initializeStorage', { reference: true }),
            LOAD_STORAGE: this.reference.getSync('loadStorage', { reference: true }),
            ALLOCATE_MEMORY: this.reference.getSync('allocateMemory', { reference: true }),
            IS_INITIALIZED: this.reference.getSync('isInitialized', { reference: true }),
            PURGE_MEMORY: this.reference.getSync('purgeMemory', { reference: true }),
            SET_MAX_GAS: this.reference.getSync('setMaxGas', { reference: true }),
        };
    }

    private getCallOptions(): ReferenceApplyOptions {
        return {
            timeout: VMIsolator.EXECUTION_TIMEOUT,
        };
    }

    private INIT(owner: string, contractAddress: string): void {
        if (!this.methods) {
            throw new Error('Methods not defined [INIT]');
        }

        this.methods.INIT_METHOD.applySync(
            undefined,
            [owner, contractAddress],
            this.getCallOptions(),
        );
    }

    private getContractWasm(): Number {
        if (!this.methods) {
            throw new Error('Methods not defined [GET_CONTRACT]');
        }

        const result = this.methods.GET_CONTRACT_METHOD.applySync(
            undefined,
            [],
            this.getCallOptions(),
        ) as Reference<Number>;

        const resp = result.copySync();
        result.release();

        return resp;
    }

    private async readMethod(
        method: number,
        contract: Number,
        data: Uint8Array,
        caller: string | null,
    ): Promise<Uint8Array> {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        const externalCopy = new ivm.ExternalCopy(data);
        const externalContract = new ivm.ExternalCopy(contract);

        const result = (await this.methods.READ_METHOD.apply(
            undefined,
            [
                method,
                externalContract.copyInto({ release: true }),
                externalCopy.copyInto({ release: true }),
                caller,
            ],
            this.getCallOptions(),
        )) as Reference<Uint8Array>;

        const resp = result.copySync();
        result.release();

        return resp;
    }

    private getViewABI(): Uint8Array {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        const result = this.methods.GET_VIEW_ABI.applySync(
            undefined,
            [],
            this.getCallOptions(),
        ) as Reference<Uint8Array>;
        const resp = result.copySync();
        result.release();

        return resp;
    }

    private readView(method: number, contract?: Number | null): Uint8Array {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        const externalCopy = new ivm.ExternalCopy(contract);
        const result = this.methods.READ_VIEW.applySync(
            undefined,
            [method, externalCopy.copyInto({ release: true })],
            this.getCallOptions(),
        ) as Reference<Uint8Array>;

        const resp = result.copySync();
        result.release();

        return resp;
    }

    private getEvents(): Uint8Array {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        const result = this.methods.GET_EVENTS.applySync(
            undefined,
            [],
            this.getCallOptions(),
        ) as Reference<Uint8Array>;
        const resp = result.copySync();
        result.release();

        return resp;
    }

    private getMethodABI(): Uint8Array {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        const result = this.methods.GET_METHOD_ABI.applySync(
            undefined,
            [],
            this.getCallOptions(),
        ) as Reference<Uint8Array>;
        const resp = result.copySync();
        result.release();

        return resp;
    }

    private getWriteMethods(): Uint8Array {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        const result = this.methods.GET_WRITE_METHODS.applySync(
            undefined,
            [],
            this.getCallOptions(),
        ) as Reference<Uint8Array>;
        const resp = result.copySync();
        result.release();

        return resp;
    }

    private getRequiredStorage(): Uint8Array {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        const result = this.methods.GET_REQUIRED_STORAGE.applySync(
            undefined,
            [],
            this.getCallOptions(),
        ) as Reference<Uint8Array>;
        const resp = result.copySync();
        result.release();

        return resp;
    }

    private getModifiedStorage(): Uint8Array {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        const result = this.methods.GET_MODIFIED_STORAGE.applySync(
            undefined,
            [],
            this.getCallOptions(),
        ) as Reference<Uint8Array>;
        const resp = result.copySync();
        result.release();

        return resp;
    }

    private initializeStorage(): Uint8Array {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        const result = this.methods.INITIALIZE_STORAGE.applySync(
            undefined,
            [],
            this.getCallOptions(),
        ) as Reference<Uint8Array>;

        const resp = result.copySync();
        result.release();

        return resp;
    }

    private loadStorage(data: Uint8Array): void {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        const externalCopy = new ivm.ExternalCopy(data);
        this.methods.LOAD_STORAGE.applySync(
            undefined,
            [externalCopy.copyInto({ release: true })],
            this.getCallOptions(),
        );
    }

    private allocateMemory(size: number): number {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        return this.methods.ALLOCATE_MEMORY.applySync(undefined, [size], this.getCallOptions());
    }

    private isInitialized(): boolean {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        return this.methods.IS_INITIALIZED.applySync(undefined, [], this.getCallOptions());
    }

    private purgeMemory(): void {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        this.methods.PURGE_MEMORY.applySync(undefined, [], this.getCallOptions());
    }

    private setMaxGas(maxGas: bigint): void {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        this.methods.SET_MAX_GAS.applySync(
            undefined,
            [new ivm.ExternalCopy(maxGas).copyInto({ release: true })],
            this.getCallOptions(),
        );
    }

    private getRuntime(): VMRuntime {
        return {
            INIT: this.INIT.bind(this),
            getContract: this.getContractWasm.bind(this),
            readMethod: this.readMethod.bind(this),
            getViewABI: this.getViewABI.bind(this),
            readView: this.readView.bind(this),
            getEvents: this.getEvents.bind(this),
            getMethodABI: this.getMethodABI.bind(this),
            getWriteMethods: this.getWriteMethods.bind(this),
            getRequiredStorage: this.getRequiredStorage.bind(this),
            getModifiedStorage: this.getModifiedStorage.bind(this),
            initializeStorage: this.initializeStorage.bind(this),
            loadStorage: this.loadStorage.bind(this),
            allocateMemory: this.allocateMemory.bind(this),
            isInitialized: this.isInitialized.bind(this),
            purgeMemory: this.purgeMemory.bind(this),
            setMaxGas: this.setMaxGas.bind(this),
        };
    }

    private async injectOPNetDeps(bytecode: Buffer): Promise<WebAssembly.Module> {
        const meteredWasm: Buffer = meterWASM(bytecode, {
            meterType: MeterType.I64,
            costTable: {
                start: 0,
                type: {
                    params: {
                        DEFAULT: 0,
                    },
                    return_type: {
                        DEFAULT: 0,
                    },
                },
                import: 0,
                code: {
                    locals: {
                        DEFAULT: 1,
                    },
                    code: {
                        get_local: 300,
                        set_local: 300,
                        tee_local: 300,
                        get_global: 300,
                        set_global: 300,

                        load8_s: 300,
                        load8_u: 300,
                        load16_s: 300,
                        load16_u: 300,
                        load32_s: 300,
                        load32_u: 300,
                        load: 300,

                        store8: 300,
                        store16: 300,
                        store32: 300,
                        store: 300,

                        grow_memory: 20000,
                        current_memory: 200,

                        nop: 1,
                        block: 1,
                        loop: 1,
                        if: 1,
                        then: 200,
                        else: 200,
                        br: 200,
                        br_if: 300,
                        br_table: 200,
                        return: 200,

                        call: 200,
                        call_indirect: 20000,

                        const: 1,

                        add: 100,
                        sub: 100,
                        mul: 300,
                        div_s: 8000,
                        div_u: 8000,
                        rem_s: 8000,
                        rem_u: 8000,
                        and: 100,
                        or: 100,
                        xor: 100,
                        shl: 150,
                        shr_u: 150,
                        shr_s: 150,
                        rotl: 200,
                        rotr: 200,
                        eq: 100,
                        eqz: 100,
                        ne: 100,
                        lt_s: 100,
                        lt_u: 100,
                        le_s: 100,
                        le_u: 100,
                        gt_s: 100,
                        gt_u: 100,
                        ge_s: 100,
                        ge_u: 100,
                        clz: 300,
                        ctz: 10500,
                        popcnt: 300,

                        drop: 300,
                        select: 300,

                        unreachable: 100000000000000,
                    },
                },
                data: 0,
            },
        });

        if (!meteredWasm) {
            throw new Error('Failed to inject gas tracker into contract bytecode.');
        }

        return await WebAssembly.compile(meteredWasm);
    }

    private async loadContractFromBytecode(): Promise<boolean> {
        let errored: boolean = false;
        try {
            const wasmModule = await this.injectOPNetDeps(this.contractBytecode);
            const externalCopy = new ivm.ExternalCopy(wasmModule);

            this.jail.setSync('module', externalCopy.copyInto({ release: true }));

            this.module = await this.isolatedVM.compileModule(code);

            this.module.instantiateSync(
                this.context,
                (specifier: string, _referrer: ivm.Module) => {
                    throw new Error(`Module ${specifier} not found`);
                },
            );

            await this.module
                .evaluate({
                    timeout: VMIsolator.EXECUTION_TIMEOUT,
                })
                .catch(() => {
                    errored = true;
                });

            this.reference = this.module.namespace;
        } catch (e) {
            console.log(`Unable to load contract from bytecode: ${e}`);
        }

        return errored;
    }
}
