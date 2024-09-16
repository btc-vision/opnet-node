import {
    Address,
    ADDRESS_BYTE_LENGTH,
    BinaryReader,
    BinaryWriter,
    BufferHelper,
    DeterministicMap,
    DeterministicSet,
    MemorySlotPointer,
    MethodMap,
    NetEvent,
    Selector,
    SelectorsMap,
} from '@btc-vision/bsi-binary';
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
import { MemorySlotData } from '@btc-vision/bsi-binary/src/buffer/types/math.js';
import { Network, networks } from 'bitcoinjs-lib';
import { BitcoinNetworkRequest } from '@btc-vision/op-vm';
import assert from 'node:assert';
import { ContractParameters, RustContract } from '../isolated/RustContract.js';

export class ContractEvaluator extends Logger {
    public readonly logColor: string = '#00ffe1';

    private isProcessing: boolean = false;

    private viewAbi: SelectorsMap = new DeterministicMap((a: string, b: string) => {
        return BinaryReader.stringCompare(a, b);
    });

    private methodAbi: MethodMap = new DeterministicSet<Selector>((a: number, b: number) => {
        return BinaryReader.numberCompare(a, b);
    });

    private writeMethods: MethodMap = new DeterministicSet<Selector>((a: number, b: number) => {
        return BinaryReader.numberCompare(a, b);
    });

    private contractOwner: Address | undefined;
    private contractAddress: Address | undefined;

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
              virtualAddress: Buffer;
              bytecodeLength: bigint;
          }
        | undefined
    > {
        throw new Error('Method not implemented. [deployContractAtAddress]');
    }

    public setContractInformation(contractInformation: ContractInformation): void {
        // We use pub the pub key as the deployer address.
        const contractDeployer: string = contractInformation.deployerAddress;
        if (!contractDeployer || contractDeployer.length > ADDRESS_BYTE_LENGTH) {
            throw new Error(`Invalid contract deployer "${contractDeployer}"`);
        }

        this.contractOwner = contractDeployer;
        this.contractAddress = contractInformation.contractAddress;
        this.bytecode = contractInformation.bytecode;
    }

    public delete(): void {
        if (!this._contractInstance?.disposed && this._contractInstance?.instantiated) {
            this.contractInstance.dispose();
        }

        delete this._contractInstance;
    }

    public getViewSelectors(): SelectorsMap {
        return this.viewAbi;
    }

    public getMethodSelectors(): MethodMap {
        return this.methodAbi;
    }

    //public getWriteMethods(): MethodMap {
    //    return this.writeMethods;
    //}

    public isViewMethod(selector: Selector): boolean {
        const keys = Array.from(this.viewAbi.values());

        for (const key of keys) {
            if (key === selector) {
                return true;
            }
        }

        return false;
    }

    public async execute(params: ExecutionParameters): Promise<ContractEvaluation> {
        if (this.isProcessing) {
            throw new Error('Contract is already processing');
        }

        this.isProcessing = true;

        try {
            this.delete();

            const evaluation = new ContractEvaluation({
                ...params,
                canWrite: false,
            });

            this.loadContractFromBytecode(evaluation);
            await this.defineSelectorAndSetupEnvironment(evaluation);
            await this.setupContract();

            if (!evaluation.calldata && !evaluation.isView) {
                throw new Error('Calldata is required.');
            }

            const canWrite: boolean = this.canWrite(evaluation.abi);
            evaluation.setCanWrite(canWrite);

            try {
                // We execute the method.
                await this.evaluate(evaluation);
            } catch (e) {
                evaluation.revert = e as Error;
            }

            this.isProcessing = false;

            this.delete();

            if (this.enableTracing) {
                console.log(
                    `EXECUTION GAS USED: ${evaluation.gasTracker.gasUsed} - TRANSACTION FINAL GAS: ${evaluation.gasUsed} - TOOK ${evaluation.gasTracker.timeSpent}ms`,
                );
            }

            /*if (!evaluation.revert) {
                for (let [contractAddress, value] of evaluation.storage) {
                    for (let [pointer, data] of value) {
                        console.log(
                            `Contract: ${contractAddress} - Pointer: ${pointer} - Value: ${data}`,
                        );

                        await this.setStorage(contractAddress, pointer, data);
                    }
                }
            }*/

            return evaluation;
        } catch (e) {
            this.delete();

            this.isProcessing = false;
            throw e;
        }
    }

    private async defineSelectorAndSetupEnvironment(params: ExecutionParameters): Promise<void> {
        await this.setEnvironment(
            params.msgSender,
            params.txOrigin,
            params.blockNumber,
            params.blockMedian,
        );

        await this.contractInstance.defineSelectors();
    }

    // TODO: Cache this, (add the gas it took to compute in the final gas)
    private async setupContract(): Promise<void> {
        this.viewAbi = await this.getViewABI();
        this.methodAbi = await this.getMethodABI();
        this.writeMethods = await this.getWriteMethodABI();
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

        if (evaluation.contractAddress === contractAddress) {
            throw new Error('Cannot call itself');
        }

        const calldata: Uint8Array = reader.readBytesWithLength();
        evaluation.incrementCallDepth();

        const gasUsed: bigint = evaluation.gasTracker.gasUsed;
        const externalCallParams: InternalContractCallParameters = {
            contractAddress: contractAddress,
            from: evaluation.msgSender,
            txOrigin: evaluation.contractAddress,

            maxGas: evaluation.gasTracker.maxGas,
            gasUsed: gasUsed,

            externalCall: true,
            blockHeight: evaluation.blockNumber,
            blockMedian: evaluation.blockMedian,

            // data
            calldata: Buffer.from(calldata),

            transactionId: evaluation.transactionId,
            transactionHash: evaluation.transactionHash,

            contractDeployDepth: evaluation.contractDeployDepth,
            callDepth: evaluation.callDepth,

            deployedContracts: evaluation.deployedContracts,
            storage: evaluation.storage,
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
        response.writeBytes(deployResult.virtualAddress);
        response.writeAddress(deployResult.contractAddress);
        response.writeU64(deployResult.bytecodeLength);

        return response.getBuffer();
    }

    private onDebug(_buffer: Buffer): void {
        /*const reader = new BinaryReader(buffer);
        const logData = reader.readStringWithLength();

        this.warn(`Contract log: ${logData}`);*/
    }

    /*private async encodeAddress(data: Buffer): Promise<Buffer | Uint8Array> {
        const reader = new BinaryReader(data);
        const virtualAddress = reader.readBytesWithLength();

        const address: Address = AddressGenerator.generatePKSH(
            Buffer.from(virtualAddress),
            this.network,
        );

        const response = new BinaryWriter();
        response.writeAddress(address);

        return response.getBuffer();
    }*/

    private getNetwork(): BitcoinNetworkRequest {
        switch (this.network) {
            case networks.bitcoin:
                return BitcoinNetworkRequest.Mainnet;
            case networks.testnet:
                return BitcoinNetworkRequest.Testnet;
            case networks.regtest:
                return BitcoinNetworkRequest.Regtest;
            default:
                throw new Error('Invalid network');
        }
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
            address: evaluation.contractAddress,
            bytecode: this.bytecode,
            network: this.getNetwork(),
            gasLimit: difference, //OPNetConsensus.consensus.TRANSACTIONS.MAX_GAS,
            gasCallback: evaluation.onGasUsed,
            load: async (data: Buffer) => {
                return await this.load(data, evaluation);
            },
            store: (data: Buffer) => {
                // TODO: Remove the promise
                return new Promise<Buffer | Uint8Array>((resolve) => {
                    resolve(this.store(data, evaluation));
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
        };
    }

    private loadContractFromBytecode(evaluation: ContractEvaluation): boolean {
        let errored: boolean = false;
        try {
            const params = this.generateContractParameters(evaluation);

            this._contractInstance = new RustContract(params);
        } catch {
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
        if (setIfNotExit && defaultValueBuffer === null) {
            throw new Error('Default value buffer is required');
        }

        const canInitialize: boolean = address === this.contractAddress ? setIfNotExit : false;

        return this.getStorage(address, pointer, defaultValueBuffer, canInitialize, blockNumber);
    }

    private async evaluate(evaluation: ContractEvaluation): Promise<void> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const hasSelectorInMethods = this.methodAbi.has(evaluation.abi) ?? false;

        let result: Uint8Array | undefined | null;
        let error: Error | undefined;

        // TODO: Check the pointer header when getting the result so we dont have to reconstruct the buffer in ram.
        try {
            result = hasSelectorInMethods
                ? await this.contractInstance.readMethod(evaluation.abi, evaluation.calldata)
                : await this.contractInstance.readView(evaluation.abi);
        } catch (e) {
            error = (await e) as Error;
        }

        if (error || !result) {
            if (!evaluation.revert && error) {
                evaluation.revert = error;
            }

            return;
        }

        if (result.length > OPNetConsensus.consensus.TRANSACTIONS.MAXIMUM_RECEIPT_LENGTH) {
            evaluation.revert = new Error('Result is too long');

            return;
        }

        // Check if result only contains zeros or is false.
        const isSuccess: boolean = result.length > 0;
        if (!isSuccess) {
            evaluation.revert = new Error('execution reverted due to an unknown error');
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

            const events: NetEvent[] = await this.getEvents();
            evaluation.setEvent(evaluation.contractAddress, events);
            evaluation.setResult(result);
        }

        if (evaluation.revert) {
            this.delete();
        }
    }

    private async getEvents(): Promise<NetEvent[]> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const abiBuffer = await this.contractInstance.getEvents();
        const abiDecoder = new BinaryReader(abiBuffer);

        return abiDecoder.readEvents();
    }

    private async setEnvironment(
        msgSender: Address,
        txOrigin: Address,
        blockNumber: bigint,
        blockMedian: bigint,
    ): Promise<void> {
        if (!this.contractInstance || !this.contractOwner || !this.contractAddress) {
            throw new Error('Contract not initialized');
        }

        const binaryWriter: BinaryWriter = new BinaryWriter();
        binaryWriter.writeAddress(msgSender);
        binaryWriter.writeAddress(txOrigin);
        binaryWriter.writeU256(blockNumber);

        binaryWriter.writeAddress(this.contractOwner);
        binaryWriter.writeAddress(this.contractAddress);
        binaryWriter.writeU256(blockMedian);

        await this.contractInstance.setEnvironment(binaryWriter.getBuffer());
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

    private canWrite(abi: Selector): boolean {
        return this.writeMethods.has(abi);
    }

    private async getViewABI(): Promise<SelectorsMap> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const abi = await this.contractInstance.getViewABI();
        const abiDecoder = new BinaryReader(abi);

        return abiDecoder.readViewSelectorsMap();
    }

    private async getMethodABI(): Promise<MethodMap> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const abi = await this.contractInstance.getMethodABI();
        const abiDecoder = new BinaryReader(abi);

        return abiDecoder.readMethodSelectorsMap();
    }

    private async getWriteMethodABI(): Promise<MethodMap> {
        if (!this.contractInstance) {
            throw new Error('Contract not initialized');
        }

        const abi = await this.contractInstance.getWriteMethods();
        const abiDecoder = new BinaryReader(abi);

        return abiDecoder.readMethodSelectorsMap();
    }
}
