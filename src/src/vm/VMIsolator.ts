import { ContractEvaluator } from './runtime/ContractEvaluator.js';
import { MemoryValue } from './storage/types/MemoryValue.js';
import { StoragePointer } from './storage/types/StoragePointer.js';
import { Address } from '@btc-vision/bsi-binary';
import { VMRuntime } from './wasmRuntime/VMRuntime.js';
import { InternalContractCallParameters } from './runtime/types/InternalContractCallParameters.js';
import { ContractEvaluation } from './runtime/classes/ContractEvaluation.js';
import { Contract, init } from '@btc-vision/bsi-wasmer-vm';
import { GasTracker } from './runtime/GasTracker.js';
import { loadRust } from './isolated/LoaderV2.js';

init();

interface IContract extends Contract {
    __pin(pointer: number): number;

    __unpin(pointer: number): number;

    __new(size: number, align: number): number;
}

interface AdaptedExports extends IContract {
    getContract(): Number;

    readMethod(method: number, contractPointer: Number, data: Uint8Array): Uint8Array;

    readView(method: number, contractPointer?: Number | null): Uint8Array;

    getViewABI(): Uint8Array;

    getEvents(): Uint8Array;

    getMethodABI(): Uint8Array;

    getWriteMethods(): Uint8Array;

    getModifiedStorage(): Uint8Array;

    initializeStorage(): Uint8Array;

    loadStorage(data: Uint8Array): Uint8Array;

    loadCallsResponse(data: Uint8Array): Uint8Array;

    getCalls(): Uint8Array;

    setEnvironment(data: Uint8Array): void;

    purgeMemory(): void;
}

export class VMIsolator {
    private contract: ContractEvaluator | null = null;

    private readonly opnetContractBytecode: Buffer | null = null;

    private opnetContract: AdaptedExports | undefined;

    constructor(
        public readonly contractAddress: string,
        contractBytecode: Buffer,
    ) {
        // Prevent having to recompute this every time we need to reset the VM
        this.opnetContractBytecode = contractBytecode; //this.injectOPNetDeps(contractBytecode);
    }

    public onGasUsed: (gas: bigint) => void = () => {};

    public getStorage(
        _address: Address,
        _pointer: StoragePointer,
        _defaultValue: MemoryValue | null,
        _setIfNotExit: boolean,
        _blockNumber: bigint,
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
    ): Promise<ContractEvaluation> {
        throw new Error('Method not implemented. [callExternal]');
    }

    /**
     * VERY IMPORTANT.
     * This method is used to reset the VM if something goes wrong.
     */
    public async reset(): Promise<boolean> {
        this.dispose();

        return await this.setupJail();
    }

    public async setupJail(): Promise<boolean> {
        let errored = await this.loadContractFromBytecode();
        if (errored) {
            return errored;
        }

        if (!this.contract) {
            this.contract = new ContractEvaluator(this);
        }

        const runTime: VMRuntime = this.getRuntime();
        await this.contract.init(runTime);

        return false;
    }

    public dispose(): void {
        delete this.opnetContract;
    }

    private async getContractWasm(): Promise<Number> {
        if (!this.opnetContract) throw new Error('Contract not loaded');

        return this.opnetContract.getContract();
    }

    private async readMethod(
        method: number,
        contract: Number,
        data: Uint8Array,
    ): Promise<Uint8Array> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        return this.opnetContract.readMethod(method, contract, data);
    }

    private async getViewABI(): Promise<Uint8Array> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        return this.opnetContract.getViewABI();
    }

    private async readView(method: number, contract?: Number | null): Promise<Uint8Array> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        return this.opnetContract.readView(method, contract);
    }

    private async getEvents(): Promise<Uint8Array> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        return this.opnetContract.getEvents();
    }

    private async getMethodABI(): Promise<Uint8Array> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        return this.opnetContract.getMethodABI();
    }

    private async getWriteMethods(): Promise<Uint8Array> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        return this.opnetContract.getWriteMethods();
    }

    private async getModifiedStorage(): Promise<Uint8Array> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        return this.opnetContract.getModifiedStorage();
    }

    private async initializeStorage(): Promise<Uint8Array> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        return this.opnetContract.initializeStorage();
    }

    private async loadStorage(data: Uint8Array): Promise<void> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        this.opnetContract.loadStorage(data);
    }

    private async setMaxGas(maxGas: bigint, usedGas: bigint, initialGas: bigint): Promise<void> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        const alreadyUsedGas: bigint = GasTracker.MAX_GAS - maxGas + (usedGas || 0n) + initialGas;
        if (alreadyUsedGas < 0n) {
            throw new Error('Out of gas');
        }

        this.opnetContract.setUsedGas(alreadyUsedGas);
    }

    private async loadCallsResponse(data: Uint8Array): Promise<void> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        this.opnetContract.loadCallsResponse(data);
    }

    private async getCalls(): Promise<Uint8Array> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        return this.opnetContract.getCalls();
    }

    private async setEnvironment(data: Uint8Array): Promise<void> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        this.opnetContract.setEnvironment(data);
    }

    private async purgeMemory(): Promise<void> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        this.opnetContract.purgeMemory();
    }

    private getRuntime(): VMRuntime {
        return {
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
            setMaxGas: this.setMaxGas.bind(this),
            purgeMemory: this.purgeMemory.bind(this),

            // contract calls
            loadCallsResponse: this.loadCallsResponse.bind(this),
            getCalls: this.getCalls.bind(this),
            setEnvironment: this.setEnvironment.bind(this),
        };
    }

    private onGas(gas: bigint) {
        this.onGasUsed(gas);
    }

    private async loadContractFromBytecode(): Promise<boolean> {
        if (!this.opnetContractBytecode) {
            throw new Error('Contract bytecode not loaded');
        }

        let errored: boolean = false;
        try {
            this.opnetContract = await loadRust(
                this.opnetContractBytecode,
                GasTracker.MAX_GAS,
                this.onGas.bind(this),
            );
        } catch (e) {
            console.log(`Unable to load contract from bytecode: ${(e as Error).stack}`);
            errored = true;
        }

        return errored;
    }
}
