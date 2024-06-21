import { ContractEvaluator } from './runtime/ContractEvaluator.js';
import { MemoryValue } from './storage/types/MemoryValue.js';
import { StoragePointer } from './storage/types/StoragePointer.js';
import { Address } from '@btc-vision/bsi-binary';
import { ExtendedIsolator, VMRuntime } from './wasmRuntime/VMRuntime.js';
import { InternalContractCallParameters } from './runtime/types/InternalContractCallParameters.js';
import { ContractEvaluation } from './runtime/classes/ContractEvaluation.js';
import { loadRust } from './isolated/LoaderV2.js';
import { OPNetConsensus } from '../poa/configurations/OPNetConsensus.js';

export class VMIsolator {
    private contract: ContractEvaluator | undefined;

    private readonly opnetContractBytecode: Buffer;

    private opnetContract: ExtendedIsolator | undefined;

    constructor(
        public readonly contractAddress: string,
        contractBytecode: Buffer,
    ) {
        // Prevent having to recompute this every time we need to reset the VM
        this.opnetContractBytecode = contractBytecode; //this.injectOPNetDeps(contractBytecode);
    }

    public onGasUsed: (gas: bigint) => void = () => {
        throw new Error('Method not implemented. [onGasUsed]');
    };

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
        if (this.opnetContract) {
            this.opnetContract.dispose();
        }

        delete this.opnetContract;
    }

    private async readMethod(method: number, data: Uint8Array): Promise<Uint8Array> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        return await this.opnetContract.readMethod(method, data);
    }

    private async getViewABI(): Promise<Uint8Array> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        return await this.opnetContract.getViewABI();
    }

    private async readView(method: number): Promise<Uint8Array> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        return await this.opnetContract.readView(method);
    }

    private async getEvents(): Promise<Uint8Array> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        return await this.opnetContract.getEvents();
    }

    private async getMethodABI(): Promise<Uint8Array> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        return await this.opnetContract.getMethodABI();
    }

    private async getWriteMethods(): Promise<Uint8Array> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        return await this.opnetContract.getWriteMethods();
    }

    private async getModifiedStorage(): Promise<Uint8Array> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        return await this.opnetContract.getModifiedStorage();
    }

    private async initializeStorage(): Promise<Uint8Array> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        return await this.opnetContract.initializeStorage();
    }

    private async loadStorage(data: Uint8Array): Promise<void> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        await this.opnetContract.loadStorage(data);
    }

    private setGasUsed(maxGas: bigint, usedGas: bigint, initialGas: bigint): void {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        const alreadyUsedGas: bigint =
            OPNetConsensus.consensus.TRANSACTIONS.MAX_GAS - maxGas + (usedGas || 0n) + initialGas;
        if (alreadyUsedGas < 0n) {
            throw new Error(`Out of gas (${alreadyUsedGas})`);
        }

        this.opnetContract.setUsedGas(alreadyUsedGas);
    }

    private async loadCallsResponse(data: Uint8Array): Promise<void> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        await this.opnetContract.loadCallsResponse(data);
    }

    private async getCalls(): Promise<Uint8Array> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        return await this.opnetContract.getCalls();
    }

    private async setEnvironment(data: Uint8Array): Promise<void> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        await this.opnetContract.setEnvironment(data);
    }

    private async defineSelectors(): Promise<void> {
        if (!this.opnetContract) {
            throw new Error('Contract not loaded');
        }

        await this.opnetContract.defineSelectors();
    }

    private async instanciate(): Promise<void> {
        await this.loadContractFromBytecode();
    }

    private getRuntime(): VMRuntime {
        return {
            readMethod: this.readMethod.bind(this),
            getViewABI: this.getViewABI.bind(this),
            readView: this.readView.bind(this),
            getEvents: this.getEvents.bind(this),
            getMethodABI: this.getMethodABI.bind(this),
            getWriteMethods: this.getWriteMethods.bind(this),
            getModifiedStorage: this.getModifiedStorage.bind(this),
            initializeStorage: this.initializeStorage.bind(this),
            loadStorage: this.loadStorage.bind(this),
            defineSelectors: this.defineSelectors.bind(this),

            // contract calls
            loadCallsResponse: this.loadCallsResponse.bind(this),
            getCalls: this.getCalls.bind(this),
            setEnvironment: this.setEnvironment.bind(this),

            setGasUsed: this.setGasUsed.bind(this),
            instantiate: this.instanciate.bind(this),
        };
    }

    private onGas(gas: bigint) {
        this.onGasUsed(gas);
    }

    private async loadContractFromBytecode(): Promise<boolean> {
        let errored: boolean = false;
        try {
            this.opnetContract = await loadRust(
                this.opnetContractBytecode,
                OPNetConsensus.consensus.TRANSACTIONS.MAX_GAS,
                this.onGas.bind(this),
            );
        } catch (e) {
            console.log(`Unable to load contract from bytecode: ${(e as Error).stack}`);
            errored = true;
        }

        return errored;
    }
}
