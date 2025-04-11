import {
    Address,
    AddressMap,
    BinaryReader,
    BinaryWriter,
    BufferHelper,
    MemorySlotData,
    MemorySlotPointer,
    NetEvent,
} from '@btc-vision/transaction';
import { MemoryValue, ProvenPointers } from '../storage/types/MemoryValue.js';
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
import { ContractParameters, RustContract } from '../isolated/RustContract.js';
import { Blockchain } from '../Blockchain.js';
import { Config } from '../../config/Config.js';
import { NetworkConverter } from '../../config/network/NetworkConverter.js';
import {
    AccountTypeResponse,
    ExitDataResponse,
    NEW_STORAGE_SLOT_GAS_COST,
    UPDATED_STORAGE_SLOT_GAS_COST,
} from '@btc-vision/op-vm';

interface InternalCallParameters {
    readonly evaluation: ContractEvaluation;
    readonly calldata: Buffer;
    readonly isDeployment: boolean;
    readonly contractAddress: Address;
    readonly usedGas: bigint;
}

interface InternalCallResponse {
    readonly isWarm: boolean;
    readonly result: Uint8Array;
    readonly status: 0 | 1;
    readonly gasUsed: bigint;
}

export class ContractEvaluator extends Logger {
    public readonly logColor: string = '#00ffe1';

    private isProcessing: boolean = false;

    private deployerAddress: Address | undefined;
    private contractAddress: Address | undefined;

    private bytecode: Buffer | undefined;

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
        _blockNumber: bigint,
        _doNotLoad: boolean,
    ): Promise<MemoryValue | null> {
        throw new Error('Method not implemented. [getStorage]');
    }

    public getStorageMultiple(
        _pointerList: AddressMap<Uint8Array[]>,
        _blockNumber: bigint,
    ): Promise<ProvenPointers | null> {
        throw new Error('Method not implemented. [getStorageMultiple]');
    }

    public setStorage(_address: Address, _pointer: bigint, _value: bigint): void {
        throw new Error('Method not implemented. [setStorage]');
    }

    public callExternal(_params: InternalContractCallParameters): Promise<ContractEvaluation> {
        throw new Error('Method not implemented. [callExternal]');
    }

    public async getBlockHashForBlockNumber(_blockNumber: bigint): Promise<Buffer> {
        throw new Error('Method not implemented. [getBlockHashForBlockNumber]');
    }

    public async isContract(_address: Address): Promise<boolean> {
        throw new Error('Method not implemented.');
    }

    public deployContractAtAddress(
        _address: Address,
        _salt: Buffer,
        _evaluation: ContractEvaluation,
    ): Promise<
        | {
              contractAddress: Address;
              bytecodeLength: number;
          }
        | undefined
    > {
        throw new Error('Method not implemented. [deployContractAtAddress]');
    }

    public setContractInformation(contractInformation: ContractInformation): void {
        // We use pub the pub key as the deployer address.
        this.deployerAddress = contractInformation.deployerAddress;
        this.contractAddress = contractInformation.contractTweakedPublicKey;
        this.bytecode = contractInformation.bytecode;
    }

    public delete(): void {
        const oldInstance = this._contractInstance;

        delete this._contractInstance;

        if (oldInstance && !oldInstance.disposed && oldInstance.instantiated) {
            oldInstance.dispose();
        }
    }

    public async run(params: ExecutionParameters): Promise<ContractEvaluation> {
        if (this.isProcessing) {
            throw new Error('Impossible state: Contract is already processing');
        }

        if (this._contractInstance) {
            throw new Error('Impossible state: Concurrency detected.');
        }

        this.isProcessing = true;

        try {
            const evaluation = new ContractEvaluation(params);
            try {
                const loadedContract = this.loadContractFromBytecode(evaluation);
                if (loadedContract) throw new Error('OP_NET: Invalid contract bytecode.');

                this.setEnvironment(evaluation);

                await this.preloadPointers(evaluation);

                // We execute the method.
                if (params.isDeployment) {
                    await this.onDeploy(evaluation);
                } else {
                    await this.execute(evaluation);
                }

                await this.terminateEvaluation(evaluation);
            } catch (e) {
                this.attemptToSetGasUsed(evaluation);

                evaluation.revert = e as Error;
            }

            return evaluation;
        } finally {
            try {
                this.delete();
            } catch {}

            this.isProcessing = false;
        }
    }

    private async terminateEvaluation(evaluation: ContractEvaluation): Promise<void> {
        await Promise.resolve();

        if (evaluation.externalCall || evaluation.revert) {
            return;
        }

        // TODO: Verify and charge gas for modified storage.
        await this.calculateGasCostStore(evaluation);

        // Deploy the required contracts.
        const deploymentPromises: Promise<void>[] = [];
        if (evaluation.deployedContracts.size > 0) {
            const contracts = evaluation.deployedContracts.values();
            for (const contractInfo of contracts) {
                deploymentPromises.push(this.deployContract(contractInfo));
            }
        }

        // We deploy contract at the end of the transaction. This is on purpose, so we can revert more easily.
        await Promise.safeAll(deploymentPromises);
    }

    private async calculateGasCostStore(evaluation: ContractEvaluation): Promise<void> {
        if (!evaluation.modifiedStorage) {
            return;
        }

        // TODO: Optimize using getStorageMultiple.
        let totalGasCost: bigint = 0n;
        for (const states of evaluation.modifiedStorage.values()) {
            let cost: bigint = 0n;

            for (const [key, value] of states) {
                const currentValue = await this.getStorageState(evaluation, key, false);

                if (currentValue === null) {
                    cost += NEW_STORAGE_SLOT_GAS_COST;
                } else if (currentValue !== value) {
                    cost += UPDATED_STORAGE_SLOT_GAS_COST;
                }

                // Check if the gas used is less than the maximum.
                if (evaluation.maxGas < evaluation.gasUsed + cost) {
                    // Set the gas used to the maximum.
                    evaluation.setGasUsed(evaluation.maxGas);

                    throw new Error(`out of gas (consumed: ${evaluation.maxGas})`);
                }
            }

            totalGasCost += cost;
        }

        evaluation.setGasUsed(evaluation.gasUsed + totalGasCost);
    }

    private attemptToSetGasUsed(evaluation: ContractEvaluation): void {
        try {
            const gasUsed = this.getGasUsed(evaluation);
            if (evaluation.gasUsed > gasUsed) {
                throw new Error('OP_NET: Gas used returned is smaller than already used gas.');
            } else {
                evaluation.setGasUsed(gasUsed);
            }
        } catch {}
    }

    private getGasUsed(evaluation: ContractEvaluation): bigint {
        try {
            if (this._contractInstance) {
                return this._contractInstance.getUsedGas();
            } else {
                return evaluation.maxGas;
            }
        } catch {
            return evaluation.maxGas;
        }
    }

    private async preloadPointers(evaluation: ContractEvaluation): Promise<void> {
        if (!evaluation.preloadStorageList) {
            return;
        }

        const values = evaluation.preloadStorageList.values();

        let totalPointerPreload: number = 0;
        for (const value of values) {
            totalPointerPreload += value.length;
        }

        const gasCostPreload =
            OPNetConsensus.consensus.GAS.COST.COLD_STORAGE_LOAD * BigInt(totalPointerPreload);

        // TODO: Add gas cost to the evaluation.
        if (gasCostPreload > evaluation.maxGas) {
            throw new Error('OP_NET: Preloading pointers exceeds gas limit');
        }

        const pointers = await this.getStorageMultiple(
            evaluation.preloadStorageList,
            evaluation.blockNumber,
        );

        evaluation.preloadedStorage(pointers);
    }

    /** Load a pointer */
    private async load(data: Buffer, evaluation: ContractEvaluation): Promise<Buffer | Uint8Array> {
        const reader: BinaryReader = new BinaryReader(data);
        const pointer: bigint = reader.readU256();

        let wasCold: boolean = false;
        let pointerResponse: MemorySlotData<bigint> | undefined = evaluation.getStorage(pointer);
        if (pointerResponse === undefined) {
            pointerResponse = (await this.getStorageState(evaluation, pointer, false)) || 0n;

            evaluation.addToStorage(pointer, pointerResponse);
            wasCold = true;
        }

        const response: BinaryWriter = new BinaryWriter();
        response.writeU256(pointerResponse);
        response.writeBoolean(wasCold);

        return response.getBuffer();
    }

    /** Store a pointer */
    private store(data: Buffer, evaluation: ContractEvaluation): Buffer | Uint8Array {
        const reader = new BinaryReader(data);
        const pointer: bigint = reader.readU256();
        const value: bigint = reader.readU256();

        evaluation.setStorage(pointer, value);

        return new Uint8Array([1]);
    }

    /** Call a contract */
    private async call(data: Buffer, evaluation: ContractEvaluation): Promise<Buffer | Uint8Array> {
        let gasUsed: bigint = evaluation.gasUsed;

        try {
            const reader = new BinaryReader(data);

            // Update the gas used.
            gasUsed = reader.readU64();
            evaluation.setGasUsed(gasUsed);

            // Update the memory pages used.
            evaluation.memoryPagesUsed = 0n; //BigInt(reader.readU32());

            const contractAddress: Address = reader.readAddress();
            const calldata: Uint8Array = reader.readBytesWithLength();

            if (evaluation.isCallStackTooDeep()) {
                throw new Error('OP_NET: Call stack too deep.');
            }

            const response = await this.internalCall({
                evaluation,
                calldata: Buffer.from(calldata),
                isDeployment: false,
                contractAddress,
                usedGas: gasUsed,
            });

            const difference: bigint = response.gasUsed - gasUsed;
            return this.buildCallResponse(
                response.isWarm,
                difference,
                response.status,
                response.result,
            );
        } catch (e) {
            // If something goes wrong, we call exit with the error.
            evaluation.revert = e as Error;

            const difference = evaluation.gasUsed - gasUsed;
            return this.buildCallResponse(false, difference, 1, evaluation.revert as Uint8Array);
        }
    }

    private async internalCall(params: InternalCallParameters): Promise<InternalCallResponse> {
        const evaluation = params.evaluation;
        const calldata = params.calldata;
        const gasUsed = params.usedGas;
        const contractAddress = params.contractAddress;

        const externalCallParams: InternalContractCallParameters = {
            contractAddress: contractAddress,
            contractAddressStr: contractAddress.p2tr(this.network),

            from: evaluation.msgSender,

            txOrigin: evaluation.txOrigin,
            msgSender: evaluation.contractAddress,

            gasTracker: evaluation.gasTracker,
            externalCall: true,

            isDeployment: params.isDeployment,
            blockHeight: evaluation.blockNumber,
            blockMedian: evaluation.blockMedian,

            calldata: calldata,
            callStack: evaluation.callStack,

            blockHash: evaluation.blockHash,
            transactionId: evaluation.transactionId,
            transactionHash: evaluation.transactionHash,

            contractDeployDepth: evaluation.contractDeployDepth,
            memoryPagesUsed: evaluation.memoryPagesUsed,

            deployedContracts: evaluation.deployedContracts,
            storage: evaluation.storage,
            preloadStorage: evaluation.preloadStorage,

            inputs: evaluation.inputs,
            outputs: evaluation.outputs,

            serializedInputs: evaluation.serializedInputs,
            serializedOutputs: evaluation.serializedOutputs,

            accessList: evaluation.accessList,
            preloadStorageList: undefined, // All pointers are already preloaded.
        };

        const isWarm: boolean = !!evaluation.touchedAddresses.get(contractAddress);
        const response = await this.callExternal(externalCallParams);
        evaluation.merge(response);

        const status = response.revert ? 1 : 0;
        const result = (status ? response.revert : response.result) || Buffer.alloc(0);

        const evaluationGasUsed = response.gasUsed - gasUsed;
        evaluation.setGasUsed(response.gasUsed);

        return {
            isWarm,
            result,
            status,
            gasUsed: evaluationGasUsed,
        };
    }

    private buildCallResponse(
        isAddressWarm: boolean,
        usedGas: bigint,
        status: 0 | 1,
        response: Uint8Array,
    ): Uint8Array {
        const writer = new BinaryWriter();
        writer.writeBoolean(isAddressWarm);
        writer.writeU64(usedGas);
        writer.writeU32(status);
        writer.writeBytes(response);

        return writer.getBuffer();
    }

    private async deployContractFromAddressRaw(
        data: Buffer,
        evaluation: ContractEvaluation,
    ): Promise<Buffer | Uint8Array> {
        let usedGas: bigint = evaluation.gasUsed;

        try {
            evaluation.incrementContractDeployDepth(); // always first.

            // Read the data from the buffer.
            const reader = new BinaryReader(data);

            // Read the gas used and set it in the evaluation.
            usedGas = reader.readU64();
            evaluation.setGasUsed(usedGas);

            // Read the contract address and salt.
            const address: Address = reader.readAddress();
            const original = reader.readBytes(32);
            const salt: Buffer = Buffer.from(original);

            // Read the calldata.
            const calldata: Buffer = Buffer.from(reader.readBytes(reader.bytesLeft()));
            const deployResult = await this.deployContractAtAddress(address, salt, evaluation);

            if (!deployResult) {
                throw new Error('OP_NET: Unable to deploy contract.');
            }

            if (deployResult.contractAddress.equals(Address.zero())) {
                throw new Error('OP_NET: Deployment failed.');
            }

            // Execute the deployment.
            const internalResult = await this.internalCall({
                evaluation,
                calldata,
                isDeployment: true,
                contractAddress: deployResult.contractAddress,
                usedGas: usedGas,
            });

            const difference = internalResult.gasUsed - usedGas;
            return this.buildDeployFromAddressResponse(
                deployResult.contractAddress,
                deployResult.bytecodeLength,
                difference,
                internalResult.status,
                internalResult.result,
            );
        } catch (e) {
            // If something goes wrong, we call exit with the error.
            evaluation.revert = e as Error;

            const difference = evaluation.gasUsed - usedGas;
            return this.buildDeployFromAddressResponse(
                Address.zero(),
                0,
                difference,
                1,
                evaluation.revert as Uint8Array,
            );
        }
    }

    private buildDeployFromAddressResponse(
        contractAddress: Address,
        bytecodeLength: number,
        usedGas: bigint,
        status: 0 | 1,
        response: Uint8Array,
    ): Uint8Array {
        const writer = new BinaryWriter();
        writer.writeAddress(contractAddress);
        writer.writeU32(bytecodeLength);
        writer.writeU64(usedGas);
        writer.writeU32(status);
        writer.writeBytes(response);

        return writer.getBuffer();
    }

    private onDebug(buffer: Buffer): void {
        const reader = new BinaryReader(buffer);
        const logData = reader.readStringWithLength();

        this.warn(`Contract log: ${logData}`);
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

    private async getAccountType(
        data: Buffer,
        evaluation: ContractEvaluation,
    ): Promise<AccountTypeResponse> {
        const reader = new BinaryReader(data);
        const targetAddress = reader.readAddress();
        const isAddressWarm = evaluation.touchedAddress(targetAddress);

        let accountType: number;
        if (isAddressWarm === undefined) {
            const isContract = await this.isContract(targetAddress);
            evaluation.touchAddress(targetAddress, isContract);

            accountType = isContract ? 1 : 0;
        } else {
            accountType = isAddressWarm ? 1 : 0;
        }

        return {
            accountType,
            isAddressWarm: isAddressWarm === undefined ? false : isAddressWarm,
        };
    }

    private async getBlockHashImport(blockNumber: bigint): Promise<Buffer> {
        const blockHash = await this.getBlockHashForBlockNumber(blockNumber);
        if (!blockHash) {
            throw new Error('OP_NET: Unable to get block hash');
        }

        return blockHash;
    }

    private generateContractParameters(evaluation: ContractEvaluation): ContractParameters {
        if (!this.bytecode) {
            throw new Error('Bytecode is required');
        }

        const difference = evaluation.maxGas - evaluation.gasUsed;
        if (difference < 0n) {
            throw new Error('out of gas');
        }

        return {
            contractManager: Blockchain.contractManager,
            address: evaluation.contractAddressStr,
            bytecode: this.bytecode,
            network: NetworkConverter.networkToBitcoinNetwork(this.network),
            gasUsed: evaluation.gasUsed,
            gasMax: evaluation.maxGas,
            memoryPagesUsed: evaluation.memoryPagesUsed,
            isDebugMode: false,
            accountType: async (data: Buffer): Promise<AccountTypeResponse> => {
                return await this.getAccountType(data, evaluation);
            },
            blockHash: async (blockNumber: bigint): Promise<Buffer> => {
                return await this.getBlockHashImport(blockNumber);
            },
            load: async (data: Buffer) => {
                return await this.load(data, evaluation);
            },
            store: (data: Buffer) => {
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
        };
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
        blockNumber: bigint,
        doNotLoad: boolean,
    ): Promise<MemoryValue | null> {
        if (!this.contractAddress) {
            throw new Error('Contract not initialized');
        }

        return this.getStorage(address, pointer, blockNumber, doNotLoad);
    }

    private async execute(evaluation: ContractEvaluation): Promise<ExitDataResponse | undefined> {
        let result: ExitDataResponse | undefined;
        let error: Error | undefined;

        try {
            result = await this.contractInstance.execute(evaluation.calldata);
        } catch (e) {
            error = (await e) as Error;
        }

        return await this.onExecutionResult(evaluation, result, error);
    }

    private async onDeploy(evaluation: ContractEvaluation): Promise<ExitDataResponse | undefined> {
        let error: Error | undefined;
        let result: ExitDataResponse | undefined;

        try {
            result = await this.contractInstance.onDeploy(evaluation.calldata);
        } catch (e) {
            error = (await e) as Error;
        }

        return await this.onExecutionResult(evaluation, result, error);
    }

    private async onExecutionResult(
        evaluation: ContractEvaluation,
        result: ExitDataResponse | undefined,
        error: Error | undefined,
    ): Promise<ExitDataResponse | undefined> {
        if (!result) {
            try {
                evaluation.setGasUsed(this.contractInstance.getUsedGas());
            } catch {
                // Fatal error
                evaluation.setGasUsed(evaluation.maxGas);
            }

            if (error) {
                evaluation.revert = error.message;
            } else {
                evaluation.revert = new Error('OP_NET: No result returned');
            }

            return;
        }

        // Keep track of the gas used.
        evaluation.setGasUsed(result.gasUsed);

        // Process the result.
        await this.processResult(result, error, evaluation);

        return result;
    }

    private async processResult(
        result: ExitDataResponse,
        error: Error | undefined,
        evaluation: ContractEvaluation,
    ): Promise<void> {
        if (!this._contractInstance) {
            throw new Error('Contract not initialized');
        }

        const data = result.data;
        if (OPNetConsensus.consensus.TRANSACTIONS.MAXIMUM_RECEIPT_LENGTH < data.length) {
            evaluation.revert = new Error(
                `OP_NET: Maximum receipt length exceeded. (${data.length} > ${OPNetConsensus.consensus.TRANSACTIONS.MAXIMUM_RECEIPT_LENGTH})`,
            );
            return;
        }

        // Check if data only contains zeros or is false.
        const isSuccess: boolean = result.status === 0;
        if (!isSuccess) {
            try {
                evaluation._revert = result.data;
            } catch {
                evaluation.revert = new Error('OP_NET: An unknown error occurred.');
            }
            return;
        }

        if (!evaluation.revert && !error) {
            evaluation.setResult(result.data);
        }
    }

    private setEnvironment(evaluation: ContractEvaluation): void {
        if (!this.deployerAddress || !this.contractAddress) {
            throw new Error('OP_NET: Contract not initialized');
        }

        evaluation.setGasUsed(this.contractInstance.getUsedGas());

        this.contractInstance.setEnvironment({
            blockHash: evaluation.blockHash,
            blockNumber: evaluation.blockNumber,
            blockMedianTime: evaluation.blockMedian,
            txId: evaluation.transactionId,
            txHash: evaluation.transactionHash,
            contractAddress: this.contractAddress,
            contractDeployer: this.deployerAddress,
            caller: evaluation.msgSender,
            origin: evaluation.txOrigin, // "leftmost thing in the call chain"
        });
    }

    private async getStorageState(
        evaluation: ContractEvaluation,
        pointer: MemorySlotPointer,
        doNotLoad: boolean,
    ): Promise<bigint | null> {
        const rawData: MemoryValue = BufferHelper.pointerToUint8Array(pointer);
        const value: MemoryValue | null = await this.internalGetStorage(
            evaluation.contractAddress,
            rawData,
            evaluation.blockNumber,
            doNotLoad,
        );

        return value ? BufferHelper.uint8ArrayToValue(value) : null;
    }
}
