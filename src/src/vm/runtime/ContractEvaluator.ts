import {
    Address,
    BinaryReader,
    BinaryWriter,
    BufferHelper,
    MemorySlotData,
    MemorySlotPointer,
    NetEvent,
} from '@btc-vision/transaction';
import { MemoryValue } from '../storage/types/MemoryValue.js';
import { StoragePointer } from '../storage/types/StoragePointer.js';
import { Logger } from '@btc-vision/bsi-common';
import {
    ExecutionParameters,
    InternalContractCallParameters,
} from './types/InternalContractCallParameters.js';
import { ContractEvaluation } from './classes/ContractEvaluation.js';
import { OPNetConsensus } from '../../poa/configurations/OPNetConsensus.js';
import { ContractInformation } from '../../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { Network } from '@btc-vision/bitcoin';
import assert from 'node:assert';
import { ContractParameters, RustContract } from '../isolated/RustContract.js';
import { Blockchain } from '../Blockchain.js';
import { Config } from '../../config/Config.js';
import { NetworkConverter } from '../../config/network/NetworkConverter.js';

export class ContractEvaluator extends Logger {
    public readonly logColor: string = '#00ffe1';

    private isProcessing: boolean = false;

    private contractOwner: Address | undefined;
    private contractAddress: Address | undefined;
    private contractAddressStr: string | undefined;

    private bytecode: Buffer | undefined;
    private readonly enableTracing: boolean = false;

    constructor(private readonly network: Network) {
        super();
    }

    private _contractInstance: RustContract | undefined;

    private get contractInstance(): RustContract {
        if (!this._contractInstance) throw new Error('Contract not initialized');

        return this._contractInstance;
    }

    public deployContract(_contract: ContractInformation): Promise<void> {
        throw new Error('Method not implemented. [deployContract]');
    }

    public getStorage(
        _address: Address,
        _pointer: StoragePointer,
        _defaultValue: MemoryValue | null,
        _setIfNotExit: boolean,
        _blockNumber: bigint,
    ): Promise<MemoryValue | null> {
        throw new Error('Method not implemented. [getStorage]');
    }

    public setStorage(_address: Address, _pointer: bigint, _value: bigint): void {
        throw new Error('Method not implemented. [setStorage]');
    }

    public callExternal(_params: InternalContractCallParameters): Promise<ContractEvaluation> {
        throw new Error('Method not implemented. [callExternal]');
    }

    public deployContractAtAddress(
        _address: Address,
        _salt: Buffer,
        _evaluation: ContractEvaluation,
    ): Promise<
        | {
              contractAddress: Address;
              tweakedPublicKey: Buffer;
              bytecodeLength: bigint;
          }
        | undefined
    > {
        throw new Error('Method not implemented. [deployContractAtAddress]');
    }

    public setContractInformation(contractInformation: ContractInformation): void {
        // We use pub the pub key as the deployer address.
        this.contractOwner = contractInformation.deployerAddress;
        this.contractAddress = contractInformation.contractTweakedPublicKey;
        this.contractAddressStr = contractInformation.contractAddress;
        this.bytecode = contractInformation.bytecode;
    }

    public delete(): void {
        const oldInstance = this._contractInstance;

        delete this._contractInstance;

        if (oldInstance && !oldInstance.disposed && oldInstance.instantiated) {
            oldInstance.dispose();
        }
    }

    public async execute(params: ExecutionParameters): Promise<ContractEvaluation> {
        if (this.isProcessing) {
            throw new Error('Contract is already processing');
        }

        this.isProcessing = true;

        try {
            this.delete();

            const evaluation = new ContractEvaluation(params);
            try {
                const errored = this.loadContractFromBytecode(evaluation);
                if (errored) throw new Error('Invalid contract bytecode');

                await this.setEnvironment(evaluation);

                // We execute the method.
                if (params.isConstructor) {
                    await this.onDeploy(evaluation);
                } else {
                    await this.evaluate(evaluation);
                }
            } catch (e) {
                evaluation.revert = e as Error;
            }

            this.delete();

            if (this.enableTracing) {
                console.log(
                    `EXECUTION GAS USED (execute): ${evaluation.gasTracker.gasUsed} - TRANSACTION FINAL GAS: ${evaluation.gasUsed} - TOOK ${evaluation.gasTracker.timeSpent}ms`,
                );
            }

            this.isProcessing = false;

            return evaluation;
        } catch (e) {
            try {
                this.delete();
            } catch {}

            this.isProcessing = false;
            throw e;
        }
    }

    /** Load a pointer */
    private async load(data: Buffer, evaluation: ContractEvaluation): Promise<Buffer | Uint8Array> {
        const reader: BinaryReader = new BinaryReader(data);
        const pointer: bigint = reader.readU256();

        let pointerResponse: MemorySlotData<bigint> | undefined = evaluation.getStorage(pointer);
        if (!pointerResponse) {
            pointerResponse = (await this.getStorageState(evaluation, pointer)) || 0n;
        }

        if (this.enableTracing) {
            this.debug(`Loaded pointer ${pointer} - value ${pointerResponse}`);
        }

        const response: BinaryWriter = new BinaryWriter();
        response.writeU256(pointerResponse);

        return response.getBuffer();
    }

    /** Store a pointer */
    private store(data: Buffer, evaluation: ContractEvaluation): Buffer | Uint8Array {
        const reader = new BinaryReader(data);
        const pointer: bigint = reader.readU256();
        const value: bigint = reader.readU256();

        if (this.enableTracing) {
            this.debug(`Attempting to store pointer ${pointer} - value ${value}`);
        }

        evaluation.setStorage(pointer, value);

        const response: BinaryWriter = new BinaryWriter();
        response.writeBoolean(true); // if we want to add something in the future, we can.

        return response.getBuffer();
    }

    /** Call a contract */
    private async call(data: Buffer, evaluation: ContractEvaluation): Promise<Buffer | Uint8Array> {
        const reader = new BinaryReader(data);
        const contractAddress: Address = reader.readAddress();

        if (evaluation.contractAddress.equals(contractAddress)) {
            throw new Error('Cannot call itself');
        }

        const calldata: Uint8Array = reader.readBytesWithLength();
        evaluation.incrementCallDepth();

        const gasUsed: bigint = evaluation.gasTracker.gasUsed;
        const externalCallParams: InternalContractCallParameters = {
            contractAddress: contractAddress,
            contractAddressStr: contractAddress.p2tr(this.network),

            from: evaluation.msgSender,

            txOrigin: evaluation.txOrigin,
            msgSender: evaluation.contractAddress,

            maxGas: evaluation.gasTracker.maxGas,
            gasUsed: gasUsed,

            externalCall: true,

            blockHeight: evaluation.blockNumber,
            blockMedian: evaluation.blockMedian,
            safeU64: evaluation.safeU64,

            // data
            calldata: Buffer.from(calldata),

            transactionId: evaluation.transactionId,
            transactionHash: evaluation.transactionHash,

            contractDeployDepth: evaluation.contractDeployDepth,
            callDepth: evaluation.callDepth,

            deployedContracts: evaluation.deployedContracts,
            storage: evaluation.storage,

            inputs: evaluation.inputs,
            outputs: evaluation.outputs,

            serializedInputs: evaluation.serializedInputs,
            serializedOutputs: evaluation.serializedOutputs,
            accessList: evaluation.accessList
        };

        const response = await this.callExternal(externalCallParams);
        evaluation.merge(response);

        assert(!response.revert, 'execution reverted (call)');

        const result = response.result;
        if (!result) {
            throw new Error('No result');
        }

        const writer = new BinaryWriter();
        writer.writeU64(response.gasUsed);
        writer.writeBytes(result);

        return writer.getBuffer();
    }

    // TODO: Implement this
    private async deployContractFromAddressRaw(
        data: Buffer,
        evaluation: ContractEvaluation,
    ): Promise<Buffer | Uint8Array> {
        evaluation.incrementContractDeployDepth(); // always first.

        const reader = new BinaryReader(data);
        const address: Address = reader.readAddress();
        const original = reader.readBytes(32);
        const salt: Buffer = Buffer.from(original);

        const deployResult = await this.deployContractAtAddress(address, salt, evaluation);
        if (!deployResult) {
            throw new Error('Unable to deploy contract');
        }

        const response = new BinaryWriter();
        response.writeBytes(deployResult.tweakedPublicKey);
        response.writeAddress(deployResult.contractAddress);
        response.writeU64(deployResult.bytecodeLength);

        return response.getBuffer();
    }

    private onDebug(_buffer: Buffer): void {
        /*const reader = new BinaryReader(buffer);
        const logData = reader.readStringWithLength();

        this.warn(`Contract log: ${logData}`);*/
    }

    private onEvent(data: Buffer, evaluation: ContractEvaluation): void {
        const reader = new BinaryReader(data);
        const eventName = reader.readStringWithLength();
        const eventData = reader.readBytesWithLength();

        const event = new NetEvent(eventName, eventData);
        evaluation.emitEvent(event);
    }

    private onInputsRequested(evaluation: ContractEvaluation): Promise<Buffer | Uint8Array> {
        return Promise.resolve(evaluation.getSerializeInputUTXOs());
    }

    private onOutputsRequested(evaluation: ContractEvaluation): Promise<Buffer | Uint8Array> {
        return Promise.resolve(evaluation.getSerializeOutputUTXOs());
    }

    private generateContractParameters(evaluation: ContractEvaluation): ContractParameters {
        if (!this.bytecode) {
            throw new Error('Bytecode is required');
        }

        const difference = evaluation.maxGas - evaluation.gasTracker.gasUsed;
        if (difference < 0n) {
            throw new Error('Not enough gas left.');
        }

        return {
            contractManager: Blockchain.contractManager,
            address: evaluation.contractAddressStr,
            bytecode: this.bytecode,
            network: NetworkConverter.networkToBitcoinNetwork(this.network),
            gasLimit: difference, //OPNetConsensus.consensus.TRANSACTIONS.MAX_GAS,
            gasCallback: evaluation.onGasUsed,
            load: async (data: Buffer) => {
                return await this.load(data, evaluation);
            },
            store: (data: Buffer) => {
                // TODO: Remove the promise
                return new Promise<Buffer | Uint8Array>((resolve) => {
                    const resp = this.store(data, evaluation);

                    resolve(resp);
                });
            },
            call: async (data: Buffer) => {
                return await this.call(data, evaluation);
            },
            deployContractAtAddress: async (data: Buffer) => {
                return await this.deployContractFromAddressRaw(data, evaluation);
            },
            log: (buffer: Buffer) => {
                this.onDebug(buffer);
            },

            emit: (buffer: Buffer) => {
                this.onEvent(buffer, evaluation);
            },
            inputs: () => {
                return this.onInputsRequested(evaluation);
            },
            outputs: () => {
                return this.onOutputsRequested(evaluation);
            },
            nextPointerValueGreaterThan: (data: Buffer) => {
                return new Promise((resolve) => {
                    const reader = new BinaryReader(data);
                    const pointer: bigint = reader.readU256();
                    const valueAtLeast: bigint = reader.readU256();
                    const lte: boolean = reader.readBoolean();

                    resolve(this.nextPointerValueGreaterThan(pointer, lte, valueAtLeast));
                });
            },
        };
    }

    private getBestNextPointerValueGreaterThan(
        _pointer: bigint,
        _lte: boolean,
        _valueAtLeast: bigint,
    ): bigint {
        // TODO: Implement this

        throw new Error(`Experimental feature not enabled.`);
    }

    private nextPointerValueGreaterThan(
        pointer: bigint,
        lte: boolean,
        valueAtLeast: bigint,
    ): Buffer | Uint8Array {
        const pointerReturn = this.getBestNextPointerValueGreaterThan(pointer, lte, valueAtLeast);
        const response: BinaryWriter = new BinaryWriter();
        response.writeU256(pointerReturn);

        return response.getBuffer();
    }

    private loadContractFromBytecode(evaluation: ContractEvaluation): boolean {
        let errored: boolean = false;
        try {
            const params = this.generateContractParameters(evaluation);

            this._contractInstance = new RustContract(params);
        } catch (e) {
            if (Config.DEV_MODE) {
                this.warn(`Something went wrong while loading contract: ${e}`);
            }

            errored = true;
        }

        return errored;
    }

    private async internalGetStorage(
        address: Address,
        pointer: StoragePointer,
        defaultValueBuffer: MemoryValue | null,
        setIfNotExit: boolean = false,
        blockNumber: bigint,
    ): Promise<MemoryValue | null> {
        if (!this.contractAddress) {
            throw new Error('Contract not initialized');
        }

        if (setIfNotExit && defaultValueBuffer === null) {
            throw new Error('Default value buffer is required');
        }

        const canInitialize: boolean = address.equals(this.contractAddress) ? setIfNotExit : false;

        return this.getStorage(address, pointer, defaultValueBuffer, canInitialize, blockNumber);
    }

    private async evaluate(evaluation: ContractEvaluation): Promise<void> {
        let result: Uint8Array | undefined | null;
        let error: Error | undefined;

        // TODO: Check the pointer header when getting the result so we dont have to reconstruct the buffer in ram.
        try {
            result = await this.contractInstance.execute(evaluation.calldata);
        } catch (e) {
            error = (await e) as Error;
        }

        if (error) {
            try {
                evaluation.setGas(this.contractInstance.getUsedGas());
            } catch {}

            if (!evaluation.revert) {
                evaluation.revert = error.message;
            }

            return;
        }

        if (!result) {
            evaluation.revert = new Error('No result returned');
            return;
        }

        await this.processResult(result, error, evaluation);
    }

    private async onDeploy(evaluation: ContractEvaluation): Promise<void> {
        let error: Error | undefined;

        // TODO: Check the pointer header when getting the result so we dont have to reconstruct the buffer in ram.
        try {
            await this.contractInstance.onDeploy(evaluation.calldata);
        } catch (e) {
            error = (await e) as Error;
        }

        if (error) {
            try {
                evaluation.setGas(this.contractInstance.getUsedGas());
            } catch {}

            if (!evaluation.revert) {
                evaluation.revert = error.message;
            }

            return;
        }

        await this.processResult(new Uint8Array(1).fill(1), error, evaluation);
    }

    private async processResult(
        result: Uint8Array,
        error: Error | undefined,
        evaluation: ContractEvaluation,
    ): Promise<void> {
        if (result.length > OPNetConsensus.consensus.TRANSACTIONS.MAXIMUM_RECEIPT_LENGTH) {
            evaluation.revert = new Error('OP_NET: Maximum receipt length exceeded.');

            return;
        }

        // Check if result only contains zeros or is false.
        const isSuccess: boolean = result.length > 0;
        if (!isSuccess) {
            evaluation.revert = new Error('OP_NET: Contract execution failed.');
            return;
        }

        if (!evaluation.revert && !error) {
            if (!evaluation.externalCall) {
                const deploymentPromises: Promise<void>[] = [];
                if (evaluation.deployedContracts.length > 0) {
                    for (let i = 0; i < evaluation.deployedContracts.length; i++) {
                        const contract = evaluation.deployedContracts[i];
                        deploymentPromises.push(this.deployContract(contract));
                    }
                }

                // We deploy contract at the end of the transaction. This is on purpose, so we can revert more easily.
                await Promise.all(deploymentPromises);
            }

            evaluation.setResult(result);
        }

        if (evaluation.revert) {
            try {
                this.delete();
            } catch {}
        }
    }

    private async setEnvironment(evaluation: ContractEvaluation): Promise<void> {
        if (!this.contractOwner || !this.contractAddress) {
            throw new Error('OP_NET: Contract not initialized');
        }

        const writer = new BinaryWriter();

        writer.writeAddress(evaluation.msgSender);
        writer.writeAddress(evaluation.txOrigin); // "leftmost thing in the call chain"
        writer.writeBytes(evaluation.transactionId); // "transaction id"

        writer.writeU256(evaluation.blockNumber);
        writer.writeAddress(this.contractOwner);
        writer.writeAddress(this.contractAddress);

        writer.writeU64(evaluation.blockMedian);
        writer.writeU64(evaluation.safeU64);

        await this.contractInstance.setEnvironment(writer.getBuffer());
    }

    private async getStorageState(
        evaluation: ContractEvaluation,
        pointer: MemorySlotPointer,
    ): Promise<bigint | null> {
        const rawData: MemoryValue = BufferHelper.pointerToUint8Array(pointer);
        const value: MemoryValue | null = await this.internalGetStorage(
            evaluation.contractAddress,
            rawData,
            null,
            false,
            evaluation.blockNumber,
        );

        return value ? BufferHelper.uint8ArrayToValue(value) : null;
    }
}
