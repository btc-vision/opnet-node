import {
    Address,
    AddressMap,
    BinaryReader,
    BinaryWriter,
    BufferHelper,
    MemorySlotData,
    MemorySlotPointer,
    MLDSASecurityLevel,
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
import { Network, networks } from '@btc-vision/bitcoin';
import { ContractParameters, RustContract } from '../rust/RustContract.js';
import { Blockchain } from '../Blockchain.js';
import { Config } from '../../config/Config.js';
import { NetworkConverter } from '../../config/network/NetworkConverter.js';
import {
    AccountTypeResponse,
    BlockHashResponse,
    ExitDataResponse,
    NEW_STORAGE_SLOT_GAS_COST,
    UPDATED_STORAGE_SLOT_GAS_COST,
} from '@btc-vision/op-vm';
import { MLDSAMetadata } from '../mldsa/MLDSAMetadata.js';
import { IMLDSAPublicKey } from '../../db/interfaces/IMLDSAPublicKey.js';

//import v8 from 'v8';
//import * as vm from 'node:vm';

// enabling trace-gc
//v8.setFlagsFromString('--trace-gc');
//v8.setFlagsFromString('--expose_gc');

//global.gc = vm.runInNewContext('gc');

interface InternalCallParameters {
    readonly evaluation: ContractEvaluation;
    readonly calldata: Buffer;
    readonly isDeployment: boolean;
    readonly isUpdate: boolean;
    readonly contractAddress: Address;
}

interface InternalCallResponse {
    readonly isWarm: boolean;
    readonly result: Buffer;
    readonly status: number;
    readonly gasUsed: bigint;
}

export class ContractEvaluator extends Logger {
    public readonly logColor: string = '#00ffe1';

    private isProcessing: boolean = false;

    private deployerAddress: Address | undefined;
    private contractAddress: Address | undefined;

    private bytecode: Buffer | undefined;
    private version: number | undefined;

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

    public getBlockHashForBlockNumber(_blockNumber: bigint): Promise<Buffer> {
        throw new Error('Method not implemented. [getBlockHashForBlockNumber]');
    }

    public isContract(_address: Address): Promise<boolean> {
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

    public updateFromAddressJsFunction(
        _address: Address,
        _evaluation: ContractEvaluation,
    ): Promise<
        | {
              bytecodeLength: number;
          }
        | undefined
    > {
        throw new Error('Method not implemented. [updateFromAddressJsFunction]');
    }

    public getMLDSAPublicKey = (_address: Address): Promise<IMLDSAPublicKey | null> => {
        throw new Error('Method not implemented. [getMLDSAPublicKey]');
    };

    public setContractInformation(contractInformation: ContractInformation): void {
        // We use pub the pub key as the deployer address.
        this.deployerAddress = contractInformation.deployerAddress;
        this.contractAddress = contractInformation.contractPublicKey;
        this.bytecode = contractInformation.bytecode.subarray(1);
        this.version = contractInformation.bytecode.subarray(0, 1)[0] as number | undefined;

        if (
            !this.deployerAddress ||
            !this.contractAddress ||
            !this.bytecode ||
            typeof this.version !== 'number'
        ) {
            throw new Error('OP_NET: Invalid contract information');
        }
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
                } else if (params.isUpdate) {
                    await this.onUpdate(evaluation);
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
                // TODO: Undo the contracts deployed if an other deployment fail.
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
        let totalGasSpecial: bigint = 0n;
        for (const [address, states] of evaluation.modifiedStorage.entries()) {
            let cost: bigint = 0n;

            const isSpecialContract: boolean = !!(
                !evaluation.externalCall &&
                evaluation.specialContract &&
                evaluation.specialContract.freeGas &&
                evaluation.specialContract.address.equals(address)
            );

            const gasUsed = isSpecialContract
                ? evaluation.specialGasUsed + totalGasSpecial
                : evaluation.gasUsed + totalGasCost;
            for (const [key, value] of states) {
                let shouldThrow: boolean = false;
                if (
                    !isSpecialContract &&
                    evaluation.maxGas < gasUsed + cost + UPDATED_STORAGE_SLOT_GAS_COST
                ) {
                    shouldThrow = true;
                } else {
                    const currentValue = await this.getStorageState(evaluation, key, false);
                    if (currentValue === null) {
                        cost += NEW_STORAGE_SLOT_GAS_COST;
                    } else if (currentValue !== value) {
                        cost += UPDATED_STORAGE_SLOT_GAS_COST;
                    }

                    // Check if the gas used is less than the maximum.
                    if (!isSpecialContract && evaluation.maxGas < gasUsed + cost) {
                        shouldThrow = true;
                    }
                }

                if (shouldThrow) {
                    // Set the gas used to the maximum.
                    evaluation.setGasUsed(evaluation.paidMaximum);

                    throw new Error(`1. out of gas (consumed: ${evaluation.paidMaximum})`);
                }
            }

            if (isSpecialContract) {
                totalGasSpecial += cost;
            } else {
                totalGasCost += cost;
            }
        }

        evaluation.setFinalGasUsed(
            evaluation.gasUsed + totalGasCost,
            evaluation.specialGasUsed + totalGasSpecial,
        );
    }

    private attemptToSetGasUsed(evaluation: ContractEvaluation): void {
        try {
            const gasUsed = this.getGasUsed(evaluation);
            if (evaluation.totalGasUsed > gasUsed) {
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
                return evaluation.paidMaximum;
            }
        } catch {
            return evaluation.paidMaximum;
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
            evaluation.memoryPagesUsed = BigInt(reader.readU32());

            const contractAddress: Address = reader.readAddress();
            const calldata: Uint8Array = reader.readBytesWithLength();

            if (evaluation.isCallStackTooDeep()) {
                throw new Error('OP_NET: Call stack too deep.');
            }

            const response = await this.internalCall({
                evaluation,
                calldata: Buffer.copyBytesFrom(calldata),
                isDeployment: false,
                isUpdate: false,
                contractAddress,
            });

            if (response.status === 1 && Config.DEV_MODE) {
                this.error(
                    `Call reverted with status ${response.status} - ${RustContract.decodeRevertData(response.result)}`,
                );
            }

            let evaluationGasUsed: bigint;
            if (evaluation.specialContract && evaluation.specialContract.freeGas) {
                evaluationGasUsed = 0n;
            } else {
                evaluationGasUsed = response.gasUsed - gasUsed;
            }

            return this.buildCallResponse(
                response.isWarm,
                evaluationGasUsed,
                response.status,
                response.result,
            );
        } catch (e) {
            // If something goes wrong, we call exit with the error.
            evaluation.revert = e as Error;

            const difference = evaluation.gasUsed - gasUsed;
            return this.buildCallResponse(false, difference, 1, new Uint8Array(0));
        }
    }

    private async internalCall(params: InternalCallParameters): Promise<InternalCallResponse> {
        const evaluation = params.evaluation;
        const calldata = params.calldata;
        const contractAddress = params.contractAddress;

        const externalCallParams: InternalContractCallParameters = {
            contractAddress: contractAddress,
            contractAddressStr: contractAddress.p2op(this.network),

            from: evaluation.msgSender,

            txOrigin: evaluation.txOrigin,
            msgSender: evaluation.contractAddress,

            gasTracker: evaluation.gasTracker,
            externalCall: true,

            isDeployment: params.isDeployment,
            isUpdate: params.isUpdate,

            blockHeight: evaluation.blockNumber,
            blockMedian: evaluation.blockMedian,

            calldata: calldata,
            callStack: evaluation.callStack,

            blockHash: evaluation.blockHash,
            transactionId: evaluation.transactionId,
            transactionHash: evaluation.transactionHash,

            contractDeployDepth: evaluation.contractDeployDepth,
            contractUpdateDepth: evaluation.contractUpdateDepth,

            mldsaLoadCounter: evaluation.mldsaLoadCounter,
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
            specialContract: undefined, // DO NOT FORWARD THE SETTINGS OF A SPECIAL CONTRACT TO EXTERNAL CALLS.
        };

        const isWarm: boolean = !!evaluation.touchedAddresses.get(contractAddress);
        const response = await this.callExternal(externalCallParams);
        evaluation.merge(response);

        const status = response.revert ? 1 : 0;
        const result = (status ? response.revert : response.result) || Buffer.alloc(0);

        return {
            isWarm,
            result: Buffer.from(result.buffer, result.byteOffset, result.byteLength),
            status,
            gasUsed: response.gasUsed,
        };
    }

    private buildCallResponse(
        isAddressWarm: boolean,
        usedGas: bigint,
        status: number,
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

            if (deployResult.contractAddress.equals(Address.dead())) {
                throw new Error('OP_NET: Deployment failed.');
            }

            // Execute the deployment.
            const internalResult = await this.internalCall({
                evaluation,
                calldata,
                isDeployment: true,
                isUpdate: false,
                contractAddress: deployResult.contractAddress,
            });

            let evaluationGasUsed: bigint;
            if (evaluation.specialContract && evaluation.specialContract.freeGas) {
                evaluationGasUsed = 0n;
            } else {
                evaluationGasUsed = internalResult.gasUsed - usedGas;
            }

            return this.buildDeployFromAddressResponse(
                deployResult.contractAddress,
                deployResult.bytecodeLength,
                evaluationGasUsed,
                internalResult.status,
                internalResult.result,
            );
        } catch (e) {
            // If something goes wrong, we call exit with the error.
            evaluation.revert = e as Error;

            const difference = evaluation.gasUsed - usedGas;
            return this.buildDeployFromAddressResponse(
                Address.dead(),
                0,
                difference,
                1,
                evaluation.revert as Uint8Array,
            );
        }
    }

    private async updateContractFromAddressRaw(
        data: Buffer,
        evaluation: ContractEvaluation,
    ): Promise<Buffer | Uint8Array> {
        let usedGas: bigint = evaluation.gasUsed;

        try {
            evaluation.incrementContractUpdates();

            const reader = new BinaryReader(data);

            usedGas = reader.readU64();
            evaluation.setGasUsed(usedGas);

            const sourceAddress: Address = reader.readAddress();
            const calldata: Buffer = Buffer.from(reader.readBytes(reader.bytesLeft()));

            const updateResult = await this.updateFromAddressJsFunction(sourceAddress, evaluation);
            if (!updateResult) {
                throw new Error('OP_NET: Unable to update contract.');
            }

            if (updateResult.bytecodeLength === 0) {
                throw new Error('OP_NET: Update failed, no bytecode found at source address.');
            }

            const internalResult = await this.internalCall({
                evaluation,
                calldata,
                isDeployment: false,
                isUpdate: true,
                contractAddress: evaluation.contractAddress,
            });

            let evaluationGasUsed: bigint;
            if (evaluation.specialContract && evaluation.specialContract.freeGas) {
                evaluationGasUsed = 0n;
            } else {
                evaluationGasUsed = internalResult.gasUsed - usedGas;
            }

            return this.buildUpdateFromAddressResponse(
                updateResult.bytecodeLength,
                evaluationGasUsed,
                internalResult.status,
                internalResult.result,
            );
        } catch (e) {
            evaluation.revert = e as Error;

            const difference = evaluation.gasUsed - usedGas;
            return this.buildUpdateFromAddressResponse(
                0,
                difference,
                1,
                evaluation.revert as Uint8Array,
            );
        }
    }

    private buildUpdateFromAddressResponse(
        bytecodeLength: number,
        usedGas: bigint,
        status: number,
        response: Uint8Array,
    ): Uint8Array {
        const writer = new BinaryWriter();
        writer.writeU32(bytecodeLength);
        writer.writeU64(usedGas);
        writer.writeU32(status);
        writer.writeBytes(response);

        return writer.getBuffer();
    }

    private buildDeployFromAddressResponse(
        contractAddress: Address,
        bytecodeLength: number,
        usedGas: bigint,
        status: number,
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
        const logData = reader.readString(buffer.byteLength);

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

    private async loadMLDSA(
        data: Buffer,
        evaluation: ContractEvaluation,
    ): Promise<Buffer | Uint8Array> {
        const reader = new BinaryReader(data);
        const level: MLDSASecurityLevel = reader.readU8() as MLDSASecurityLevel;
        const address = reader.readAddress();

        const response = new BinaryWriter();
        if (evaluation.mldsaLoadCounter.value >= OPNetConsensus.consensus.MLDSA.MAX_LOADS) {
            response.writeBoolean(false);
            return response.getBuffer();
        }

        evaluation.incrementMLDSALoadCounter();

        if (!OPNetConsensus.consensus.MLDSA.ENABLED_LEVELS.includes(level)) {
            response.writeBoolean(false);

            return response.getBuffer();
        }

        const publicKeyData = await this.getMLDSAPublicKey(address);
        if (!publicKeyData || publicKeyData.level !== level || !publicKeyData.publicKey) {
            // Not revealed or wrong level.
            response.writeBoolean(false);
        } else {
            const expectedLength = MLDSAMetadata.fromLevel(level) as number;

            if (publicKeyData.publicKey.length === expectedLength) {
                response.writeBoolean(true);
                response.writeBytes(publicKeyData.publicKey);
            } else {
                response.writeBoolean(false);
            }
        }

        return response.getBuffer();
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

    private async getBlockHashImport(blockNumber: bigint): Promise<BlockHashResponse> {
        const blockHash = await this.getBlockHashForBlockNumber(blockNumber);
        if (!blockHash) {
            throw new Error('OP_NET: Unable to get block hash');
        }

        return {
            blockHash: blockHash,
            isBlockWarm: false,
        };
    }

    private generateContractParameters(evaluation: ContractEvaluation): ContractParameters {
        if (!this.bytecode) {
            throw new Error('Bytecode is required');
        }

        const difference = evaluation.maxGas - evaluation.gasUsed;
        if (difference < 0n) {
            throw new Error('out of gas');
        }

        const enableDebug =
            this.network.bech32 !== networks.bitcoin.bech32
                ? Config.DEV.ENABLE_CONTRACT_DEBUG
                : false;

        return {
            contractManager: Blockchain.contractManager,
            address: evaluation.contractAddressStr,
            bytecode: this.bytecode,
            network: NetworkConverter.networkToBitcoinNetwork(this.network),
            gasUsed: evaluation.combinedGas,
            gasMax: evaluation.maxGasVM,
            memoryPagesUsed: evaluation.memoryPagesUsed,
            isDebugMode: enableDebug,
            accountType: async (data: Buffer): Promise<AccountTypeResponse> => {
                return await this.getAccountType(data, evaluation);
            },
            blockHash: async (blockNumber: bigint): Promise<BlockHashResponse> => {
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
            updateFromAddress: async (data: Buffer) => {
                return await this.updateContractFromAddressRaw(data, evaluation);
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
            loadMLDSA: async (data: Buffer) => {
                return await this.loadMLDSA(data, evaluation);
            },

            // NOT SUPPORTED YET.
            tLoad(_: Buffer): Promise<Buffer | Uint8Array> {
                return Promise.resolve(Buffer.alloc(0));
            },
            tStore(_: Buffer): Promise<Buffer | Uint8Array> {
                return Promise.resolve(Buffer.alloc(0));
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

        return this.onExecutionResult(evaluation, result, error);
    }

    private async onDeploy(evaluation: ContractEvaluation): Promise<ExitDataResponse | undefined> {
        let error: Error | undefined;
        let result: ExitDataResponse | undefined;

        try {
            result = await this.contractInstance.onDeploy(evaluation.calldata);
        } catch (e) {
            error = (await e) as Error;
        }

        return this.onExecutionResult(evaluation, result, error);
    }

    private async onUpdate(evaluation: ContractEvaluation): Promise<ExitDataResponse | undefined> {
        let error: Error | undefined;
        let result: ExitDataResponse | undefined;

        try {
            result = await this.contractInstance.onUpdate(evaluation.calldata);
        } catch (e) {
            error = (await e) as Error;
        }

        return this.onExecutionResult(evaluation, result, error);
    }

    private onExecutionResult(
        evaluation: ContractEvaluation,
        result: ExitDataResponse | undefined,
        error: Error | undefined,
    ): ExitDataResponse | undefined {
        if (!result) {
            try {
                evaluation.setGasUsed(this.contractInstance.getUsedGas());
            } catch {
                // Fatal error
                evaluation.setGasUsed(evaluation.paidMaximum);
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
        this.processResult(result, error, evaluation);

        return result;
    }

    private processResult(
        result: ExitDataResponse,
        error: Error | undefined,
        evaluation: ContractEvaluation,
    ): void {
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
            originTweakedPublicKey: evaluation.txOrigin.tweakedPublicKeyToBuffer(),
            consensusFlags: OPNetConsensus.consensusRules.asBigInt(),
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
