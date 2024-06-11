import { MeterType, meterWASM } from '@btc-vision/wasm-metering';
import fs from 'fs';
import IsolatedVM from 'isolated-vm';
import ivm, { ArgumentType, Context, Isolate, Reference, ReferenceApplyOptions } from 'isolated-vm';
import path from 'path';

import { ContractEvaluator } from './runtime/ContractEvaluator.js';
import { MemoryValue } from './storage/types/MemoryValue.js';
import { StoragePointer } from './storage/types/StoragePointer.js';
import { Address } from '@btc-vision/bsi-binary';
import { VMRuntime } from './wasmRuntime/VMRuntime.js';
import { ExternalCallResponse } from './runtime/types/ExternalCallRequest.js';
import { InternalContractCallParameters } from './runtime/types/InternalContractCallParameters.js';

interface IsolatedMethods {
    INIT_METHOD: IsolatedVM.Reference<VMRuntime['INIT']>;
    GET_CONTRACT_METHOD: IsolatedVM.Reference<VMRuntime['getContract']>;
    LOAD_STORAGE: IsolatedVM.Reference<VMRuntime['loadStorage']>;
    GET_MODIFIED_STORAGE: IsolatedVM.Reference<VMRuntime['getModifiedStorage']>;
    READ_METHOD: IsolatedVM.Reference<VMRuntime['readMethod']>;
    READ_VIEW: IsolatedVM.Reference<VMRuntime['readView']>;
    GET_VIEW_ABI: IsolatedVM.Reference<VMRuntime['getViewABI']>;
    GET_WRITE_METHODS: IsolatedVM.Reference<VMRuntime['getWriteMethods']>;
    GET_METHOD_ABI: IsolatedVM.Reference<VMRuntime['getMethodABI']>;
    INITIALIZE_STORAGE: IsolatedVM.Reference<VMRuntime['initializeStorage']>;
    IS_INITIALIZED: IsolatedVM.Reference<VMRuntime['isInitialized']>;
    GET_EVENTS: IsolatedVM.Reference<VMRuntime['getEvents']>;
    PURGE_MEMORY: IsolatedVM.Reference<VMRuntime['purgeMemory']>;
    SET_MAX_GAS: IsolatedVM.Reference<VMRuntime['setMaxGas']>;
    LOAD_CALLS_RESPONSE: IsolatedVM.Reference<VMRuntime['loadCallsResponse']>;
    GET_CALLS: IsolatedVM.Reference<VMRuntime['getCalls']>;
    SET_ENVIRONMENT: IsolatedVM.Reference<VMRuntime['setEnvironment']>;
}

const codePath: string = path.resolve(__dirname, '../vm/isolated/IsolatedManager.js');
const code: string = fs.readFileSync(codePath, 'utf-8');

export class VMIsolator {
    public static readonly MAX_GAS: bigint = 480076812288n; // Max gas allowed for a contract execution
    private static readonly EXECUTION_TIMEOUT: number = 2 * 60 * 60000; // 2h

    private contract: ContractEvaluator | null = null;
    private isolatedVM: Isolate = this.createVM();
    private context: Context = this.createContext();

    private jail = this.context.global;

    private module: ivm.Module | null = null;
    private reference: ivm.Reference<VMRuntime> | null = null;

    private methods: IsolatedMethods | null = null;

    private readonly opnetContractBytecode: Buffer | null = null;

    constructor(
        public readonly contractAddress: string,
        contractBytecode: Buffer,
    ) {
        // Prevent having to recompute this every time we need to reset the VM
        this.opnetContractBytecode = this.injectOPNetDeps(contractBytecode);
    }

    public get CPUTime(): bigint {
        return this.isolatedVM.cpuTime;
    }

    public onGasUsed: (gas: bigint) => void = () => {};

    public getStorage(
        _address: Address,
        _pointer: StoragePointer,
        _defaultValue: MemoryValue | null,
        _setIfNotExit: boolean,
    ): Promise<MemoryValue | null> {
        throw new Error('Method not implemented. [getStorage]');
    }

    public setStorage(
        _address: Address,
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

    public async callExternal(
        _params: InternalContractCallParameters,
    ): Promise<ExternalCallResponse> {
        throw new Error('Method not implemented. [callExternal]');
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

        if (!this.contract) {
            this.contract = new ContractEvaluator(this);
        }

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
            GET_MODIFIED_STORAGE: this.reference.getSync('getModifiedStorage', { reference: true }),
            INITIALIZE_STORAGE: this.reference.getSync('initializeStorage', { reference: true }),
            LOAD_STORAGE: this.reference.getSync('loadStorage', { reference: true }),
            IS_INITIALIZED: this.reference.getSync('isInitialized', { reference: true }),
            PURGE_MEMORY: this.reference.getSync('purgeMemory', { reference: true }),
            SET_MAX_GAS: this.reference.getSync('setMaxGas', { reference: true }),
            LOAD_CALLS_RESPONSE: this.reference.getSync('loadCallsResponse', { reference: true }),
            GET_CALLS: this.reference.getSync('getCalls', { reference: true }),
            SET_ENVIRONMENT: this.reference.getSync('setEnvironment', { reference: true }),
        };
    }

    private getCallOptions(): ReferenceApplyOptions {
        return {
            timeout: VMIsolator.EXECUTION_TIMEOUT,
        };
    }

    private async INIT(owner: Address, contractAddress: Address): Promise<void> {
        if (!this.methods) {
            throw new Error('Methods not defined [INIT]');
        }

        await this.methods.INIT_METHOD.apply(
            undefined,
            [owner, contractAddress],
            this.getCallOptions(),
        );
    }

    private async getContractWasm(): Promise<Number> {
        if (!this.methods) {
            throw new Error('Methods not defined [GET_CONTRACT]');
        }

        const result = (await this.methods.GET_CONTRACT_METHOD.apply(
            undefined,
            [],
            this.getCallOptions(),
        )) as Reference<Number>;

        const resp = await result.copy();
        result.release();

        return resp;
    }

    private async readMethod(
        method: number,
        contract: Number,
        data: Uint8Array,
        caller: Address | null,
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

        const resp = await result.copy();
        result.release();

        //const profiles = await this.isolatedVM.stopCpuProfiler('test');
        //console.dir(profiles, { depth: 100, colors: true });

        return resp;
    }

    private async getViewABI(): Promise<Uint8Array> {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        const result = (await this.methods.GET_VIEW_ABI.apply(
            undefined,
            [],
            this.getCallOptions(),
        )) as Reference<Uint8Array>;

        const resp = await result.copy();
        result.release();

        return resp;
    }

    private async readView(method: number, contract?: Number | null): Promise<Uint8Array> {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        const externalCopy = new ivm.ExternalCopy(contract);
        const result = (await this.methods.READ_VIEW.apply(
            undefined,
            [method, externalCopy.copyInto({ release: true })],
            this.getCallOptions(),
        )) as Reference<Uint8Array>;

        const resp = await result.copy();
        result.release();

        return resp;
    }

    private async getEvents(): Promise<Uint8Array> {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        const result = (await this.methods.GET_EVENTS.apply(
            undefined,
            [],
            this.getCallOptions(),
        )) as Reference<Uint8Array>;
        const resp = await result.copy();
        result.release();

        return resp;
    }

    private async getMethodABI(): Promise<Uint8Array> {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        const result = (await this.methods.GET_METHOD_ABI.apply(
            undefined,
            [],
            this.getCallOptions(),
        )) as Reference<Uint8Array>;

        const resp = await result.copy();
        result.release();

        return resp;
    }

    private async getWriteMethods(): Promise<Uint8Array> {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        const result = (await this.methods.GET_WRITE_METHODS.apply(
            undefined,
            [],
            this.getCallOptions(),
        )) as Reference<Uint8Array>;

        const resp = await result.copy();
        result.release();

        return resp;
    }

    private async getModifiedStorage(): Promise<Uint8Array> {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        const result = (await this.methods.GET_MODIFIED_STORAGE.apply(
            undefined,
            [],
            this.getCallOptions(),
        )) as Reference<Uint8Array>;
        const resp = await result.copy();
        result.release();

        return resp;
    }

    private async initializeStorage(): Promise<Uint8Array> {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        const result = (await this.methods.INITIALIZE_STORAGE.apply(
            undefined,
            [],
            this.getCallOptions(),
        )) as Reference<Uint8Array>;

        const resp = await result.copy();
        result.release();

        return resp;
    }

    private async loadStorage(data: Uint8Array): Promise<void> {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        const externalCopy = new ivm.ExternalCopy(data);
        await this.methods.LOAD_STORAGE.apply(
            undefined,
            [externalCopy.copyInto({ release: true })],
            this.getCallOptions(),
        );
    }

    private async isInitialized(): Promise<boolean> {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        return (await this.methods.IS_INITIALIZED.apply(
            undefined,
            [],
            this.getCallOptions(),
        )) as boolean;
    }

    private async purgeMemory(): Promise<void> {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        await this.methods.PURGE_MEMORY.apply(undefined, [], this.getCallOptions());
    }

    private async setMaxGas(maxGas: bigint, usedGas?: bigint): Promise<void> {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        const args: [
            maxGas: ArgumentType<{}, bigint>,
            currentGasUsage?: ArgumentType<{}, bigint | undefined>,
        ] = [new ivm.ExternalCopy(maxGas).copyInto({ release: true })];

        if (usedGas) {
            args.push(new ivm.ExternalCopy(usedGas).copyInto({ release: true }));
        }

        await this.methods.SET_MAX_GAS.apply(undefined, args, this.getCallOptions());
    }

    private async loadCallsResponse(data: Uint8Array): Promise<void> {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        const externalCopy = new ivm.ExternalCopy(data);
        await this.methods.LOAD_CALLS_RESPONSE.apply(
            undefined,
            [externalCopy.copyInto({ release: true })],
            this.getCallOptions(),
        );
    }

    private async getCalls(): Promise<Uint8Array> {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        const result = (await this.methods.GET_CALLS.apply(
            undefined,
            [],
            this.getCallOptions(),
        )) as Reference<Uint8Array>;

        const resp = await result.copy();
        result.release();

        return resp;
    }

    private async setEnvironment(data: Uint8Array): Promise<void> {
        if (!this.methods) {
            throw new Error('Methods not defined');
        }

        const externalCopy = new ivm.ExternalCopy(data);
        await this.methods.SET_ENVIRONMENT.apply(
            undefined,
            [externalCopy.copyInto({ release: true })],
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
            getModifiedStorage: this.getModifiedStorage.bind(this),
            initializeStorage: this.initializeStorage.bind(this),
            loadStorage: this.loadStorage.bind(this),
            isInitialized: this.isInitialized.bind(this),
            purgeMemory: this.purgeMemory.bind(this),
            setMaxGas: this.setMaxGas.bind(this),

            // contract calls
            loadCallsResponse: this.loadCallsResponse.bind(this),
            getCalls: this.getCalls.bind(this),
            setEnvironment: this.setEnvironment.bind(this),
        };
    }

    private injectOPNetDeps(bytecode: Buffer): Buffer {
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
                        get_local: 75,
                        set_local: 210,
                        tee_local: 75,
                        get_global: 225,
                        set_global: 575,

                        load8_s: 680,
                        load8_u: 680,
                        load16_s: 680,
                        load16_u: 680,
                        load32_s: 680,
                        load32_u: 680,
                        load: 680,

                        store8: 950,
                        store16: 950,
                        store32: 950,
                        store: 950,

                        grow_memory: 8050,
                        current_memory: 3000,

                        nop: 1,
                        block: 1,
                        loop: 1,
                        if: 765,
                        then: 1,
                        else: 1,
                        br: 765,
                        br_if: 765,
                        br_table: 2400,
                        return: 1,

                        call: 3800,
                        call_indirect: 13610,

                        const: 1,

                        add: 100,
                        sub: 100,
                        mul: 160,
                        div_s: 1270,
                        div_u: 1270,
                        rem_s: 1270,
                        rem_u: 1270,
                        and: 100,
                        or: 100,
                        xor: 100,
                        shl: 100,
                        shr_u: 100,
                        shr_s: 100,
                        rotl: 100,
                        rotr: 100,
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
                        clz: 210,
                        ctz: 6000,
                        popcnt: 6000,

                        drop: 9,
                        select: 1250,

                        unreachable: 1,
                    },
                },
                data: 0,
            },
        });

        if (!meteredWasm) {
            throw new Error('Failed to inject gas tracker into contract bytecode.');
        }

        return meteredWasm;
    }

    private async loadContractFromBytecode(): Promise<boolean> {
        if (!this.opnetContractBytecode) {
            throw new Error('Contract bytecode not loaded');
        }

        let errored: boolean = false;
        try {
            const wasmModule = await WebAssembly.compile(this.opnetContractBytecode);
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
