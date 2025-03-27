import {
    Address,
    AddressMap,
    BufferHelper,
    MemorySlotData,
    TapscriptVerificator,
} from '@btc-vision/transaction';
import { DebugLevel, Globals, Logger } from '@btc-vision/bsi-common';
import { DataConverter } from '@btc-vision/bsi-db';
import { Block } from '../blockchain-indexer/processor/block/Block.js';
import { ReceiptMerkleTree } from '../blockchain-indexer/processor/block/merkle/ReceiptMerkleTree.js';
import { StateMerkleTree } from '../blockchain-indexer/processor/block/merkle/StateMerkleTree.js';
import {
    BTC_FAKE_ADDRESS,
    MAX_HASH,
    MAX_MINUS_ONE,
} from '../blockchain-indexer/processor/block/types/ZeroValue.js';
import { ContractInformation } from '../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { OPNetTransactionTypes } from '../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { DeploymentTransaction } from '../blockchain-indexer/processor/transaction/transactions/DeploymentTransaction.js';
import { InteractionTransaction } from '../blockchain-indexer/processor/transaction/transactions/InteractionTransaction.js';
import { IBtcIndexerConfig } from '../config/interfaces/IBtcIndexerConfig.js';
import {
    BlockHeader,
    BlockHeaderAPIBlockDocument,
    BlockHeaderDocument,
} from '../db/interfaces/IBlockHeaderBlockDocument.js';
import { ITransactionDocument } from '../db/interfaces/ITransactionDocument.js';
import { EvaluatedResult } from './evaluated/EvaluatedResult.js';
import { EvaluatedStates } from './evaluated/EvaluatedStates.js';
import { ContractEvaluator } from './runtime/ContractEvaluator.js';
import { VMMongoStorage } from './storage/databases/VMMongoStorage.js';
import { IndexerStorageType } from './storage/types/IndexerStorageType.js';
import { MemoryValue, ProvenMemoryValue, ProvenPointers } from './storage/types/MemoryValue.js';
import { StoragePointer } from './storage/types/StoragePointer.js';
import { VMStorage } from './storage/VMStorage.js';
import { VMBitcoinBlock } from './VMBitcoinBlock.js';
import {
    ExecutionParameters,
    InternalContractCallParameters,
} from './runtime/types/InternalContractCallParameters.js';
import { ContractEvaluation } from './runtime/classes/ContractEvaluation.js';
import { GasTracker } from './runtime/GasTracker.js';
import { OPNetConsensus } from '../poa/configurations/OPNetConsensus.js';
import bitcoin, { Network } from '@btc-vision/bitcoin';
import { NetworkConverter } from '../config/network/NetworkConverter.js';
import { Blockchain } from './Blockchain.js';
import { BlockHeaderValidator } from './BlockHeaderValidator.js';
import { Config } from '../config/Config.js';
import { BlockGasPredictor } from '../blockchain-indexer/processor/gas/BlockGasPredictor.js';
import { ParsedSimulatedTransaction } from '../api/json-rpc/types/interfaces/params/states/CallParams.js';
import { FastStringMap } from '../utils/fast/FastStringMap.js';
import { AccessList } from '../api/json-rpc/types/interfaces/results/states/CallResult.js';

Globals.register();

const EMPTY_BUFFER = Buffer.alloc(32);

export class VMManager extends Logger {
    public initiated: boolean = false;

    private readonly vmStorage: VMStorage;
    private readonly vmBitcoinBlock: VMBitcoinBlock;

    private blockState: StateMerkleTree | undefined;
    private receiptState: ReceiptMerkleTree | undefined;

    private verifiedBlockHeights: Map<bigint, Promise<boolean>> = new Map();
    private contractCache: AddressMap<ContractInformation> = new AddressMap();

    private vmEvaluators: AddressMap<Promise<ContractEvaluator | null>> = new AddressMap();
    private contractAddressCache: FastStringMap<Address> = new FastStringMap();
    private cachedLastBlockHeight: Promise<BlockHeader> | undefined;
    private isProcessing: boolean = false;

    private readonly _blockHeaderValidator: BlockHeaderValidator;

    private readonly network: Network;

    private pointerCache: AddressMap<Map<MemorySlotData<bigint>, [Uint8Array, string[]] | null>> =
        new AddressMap();

    constructor(
        private readonly config: IBtcIndexerConfig,
        private readonly isExecutor: boolean = false,
        vmStorage?: VMStorage,
    ) {
        super();

        this.network = NetworkConverter.getNetwork();

        this.vmStorage = vmStorage || this.getVMStorage();
        this.vmBitcoinBlock = new VMBitcoinBlock(this.vmStorage);
        this._blockHeaderValidator = new BlockHeaderValidator(config, this.vmStorage);
    }

    public get blockHeaderValidator(): BlockHeaderValidator {
        return this._blockHeaderValidator;
    }

    public getVMStorage(): VMStorage {
        if (this.vmStorage) return this.vmStorage;

        switch (this.config.INDEXER.STORAGE_TYPE) {
            case IndexerStorageType.MONGODB:
                return new VMMongoStorage(this.config);
            default:
                throw new Error('Invalid VM Storage type.');
        }
    }

    public async saveTransactions(
        transactions: ITransactionDocument<OPNetTransactionTypes>[],
    ): Promise<void> {
        await this.vmStorage.saveTransactions(transactions);
    }

    public async init(): Promise<void> {
        await this.vmStorage.init();

        this.initiated = true;
    }

    public purgeAllContractInstances(): void {
        try {
            Blockchain.purge();
        } catch (e) {
            this.panic(`Error purging contract instances: ${e}`);
        }
    }

    public async prepareBlock(blockId: bigint): Promise<void> {
        this.purgeAllContractInstances();

        if (this.config.DEBUG_LEVEL >= DebugLevel.TRACE) {
            this.debug(`Preparing block ${blockId}...`);
        }

        await this.vmBitcoinBlock.prepare(blockId);

        this.blockState = new StateMerkleTree();
        this.receiptState = new ReceiptMerkleTree();
    }

    public async revertBlock(): Promise<void> {
        if (this.config.DEBUG_LEVEL >= DebugLevel.TRACE) {
            this.debug(`Reverting block ${this.vmBitcoinBlock.height}...`);
        }

        await this.vmBitcoinBlock.revert();
        await this.clear();
    }

    public async terminateBlock(): Promise<void> {
        if (this.config.DEBUG_LEVEL >= DebugLevel.TRACE) {
            this.debug(`Terminating block ${this.vmBitcoinBlock.height}...`);
        }

        try {
            await this.vmBitcoinBlock.terminate();
            await this.clear();
        } catch (e) {
            this.error(`Error terminating block: ${(e as Error).stack}`);

            await this.clear();

            throw e;
        }
    }

    public busy(): boolean {
        return this.isProcessing;
    }

    /** This method is allowed to read only. It can not modify any states. */
    public async execute(
        to: string,
        from: Address,
        calldata: Buffer,
        height?: bigint,
        transaction?: ParsedSimulatedTransaction,
        accessList?: AccessList,
        preloadList?: AddressMap<Uint8Array[]>,
    ): Promise<EvaluatedResult> {
        if (this.isProcessing) {
            throw new Error(
                `VM is already processing a request. Increase the amount of VMs threads or concurrency or send fewer requests.`,
            );
        }

        if (!this.isExecutor && accessList) {
            throw new Error('Access list not allowed in execution mode.');
        }

        this.isProcessing = true;
        try {
            const contractAddress: Address | undefined = await this.getContractAddress(to);
            if (!contractAddress) {
                throw new Error('Contract not found');
            }

            let blockHash: Buffer;
            let currentHeight: BlockHeader;
            let median: bigint;
            if (height != undefined) {
                const tempBlock = await this.vmStorage.getBlockHeader(height);
                if (!tempBlock) {
                    throw new Error('Invalid block height');
                }

                currentHeight = this.convertAPIBlockHeaderToBlockHeader(
                    this.vmStorage.convertBlockHeaderToBlockHeaderDocument(tempBlock),
                );

                median = BigInt(currentHeight.medianTime);
                blockHash = currentHeight.hash;
            } else {
                currentHeight = await this.fetchCachedBlockHeight();
                median = BigInt(Date.now());
                blockHash = EMPTY_BUFFER;
            }

            // Get the contract evaluator
            const params: InternalContractCallParameters = {
                contractAddressStr: contractAddress.p2tr(this.network),
                contractAddress: contractAddress,
                from: from,
                txOrigin: from,
                maxGas: OPNetConsensus.consensus.GAS.EMULATION_MAX_GAS,
                calldata: calldata,

                blockHeight: height == undefined ? currentHeight.height + 1n : currentHeight.height,
                blockMedian: median, // add support for this

                storage: new AddressMap(),
                preloadStorage: new AddressMap(),

                allowCached: false,
                externalCall: false,
                gasUsed: 0n,
                callDepth: 0,
                contractDeployDepth: 0,

                blockHash: blockHash,
                transactionId: EMPTY_BUFFER,
                transactionHash: EMPTY_BUFFER,

                inputs: transaction ? transaction.inputs : [],
                outputs: transaction ? transaction.outputs : [],

                serializedInputs: undefined,
                serializedOutputs: undefined,

                accessList: accessList,
                preloadStorageList: preloadList,
            };

            // Execute the function
            const evaluation = await this.executeCallInternal(params);
            const result = evaluation.getEvaluationResult();
            this.isProcessing = false;

            return result;
        } catch (e) {
            this.isProcessing = false;
            throw e;
        }
    }

    public async executeTransaction(
        blockHash: Buffer,
        blockHeight: bigint,
        blockMedian: bigint,
        baseGas: bigint,
        interactionTransaction: InteractionTransaction,
        isSimulation: boolean = false,
    ): Promise<ContractEvaluation> {
        if (this.isProcessing) {
            throw new Error('Concurrency detected. (executeTransaction)');
        }

        this.isProcessing = true;

        try {
            if (this.vmBitcoinBlock.height !== blockHeight) {
                throw new Error('Block height mismatch');
            }

            const contractAddress: Address | undefined = await this.getContractAddress(
                interactionTransaction.contractAddress,
            );

            if (!contractAddress) {
                throw new Error('Contract not found');
            }

            if (this.config.DEBUG_LEVEL >= DebugLevel.TRACE) {
                this.debugBright(
                    `Attempting to execute transaction for contract ${contractAddress}`,
                );
            }

            const feeBitcoin: bigint = interactionTransaction.gasSatFee;
            if (!feeBitcoin) {
                throw new Error('execution reverted (out of gas)');
            }

            // Trace the execution time
            const maxGas: bigint = this.calculateMaxGas(isSimulation, feeBitcoin, baseGas);

            // Define the parameters for the internal call.
            const params: InternalContractCallParameters = {
                contractAddressStr: interactionTransaction.contractAddress,
                contractAddress: contractAddress,

                from: interactionTransaction.from,
                txOrigin: interactionTransaction.txOrigin,
                msgSender: interactionTransaction.msgSender,

                maxGas: maxGas,
                calldata: interactionTransaction.calldata,

                blockHash: blockHash,
                blockHeight: blockHeight,
                blockMedian: blockMedian,

                transactionId: interactionTransaction.transactionId,
                transactionHash: interactionTransaction.hash,

                storage: new AddressMap(),
                preloadStorage: new AddressMap(),

                allowCached: true,
                externalCall: false,
                gasUsed: 0n,
                callDepth: 0,
                contractDeployDepth: 0,

                inputs: interactionTransaction.strippedInputs,
                outputs: interactionTransaction.strippedOutputs,

                serializedInputs: undefined,
                serializedOutputs: undefined,

                preloadStorageList: interactionTransaction.preloadStorageList,
            };

            const result: ContractEvaluation = await this.executeCallInternal(params);
            this.isProcessing = false;

            return result;
        } catch (e) {
            this.isProcessing = false;
            throw e;
        }
    }

    public async deployContract(
        blockHash: Buffer,
        blockHeight: bigint,
        median: bigint,
        baseGas: bigint,
        contractDeploymentTransaction: DeploymentTransaction,
    ): Promise<ContractEvaluation> {
        if (this.vmBitcoinBlock.height !== blockHeight) {
            throw new Error('Block height mismatch');
        }

        if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG && Config.DEV_MODE) {
            this.debugBright(
                `Attempting to deploy contract ${contractDeploymentTransaction.contractAddress}`,
            );
        }

        const contractInformation: ContractInformation = ContractInformation.fromTransaction(
            blockHeight,
            contractDeploymentTransaction,
        );

        if (this.isProcessing) {
            throw new Error('Concurrency detected. (deployContract)');
        }

        try {
            this.isProcessing = true;

            // We must save the contract information
            await this.setContractAt(contractInformation);

            const vmEvaluator = await this.getVMEvaluatorFromParams(
                contractDeploymentTransaction.address,
                contractDeploymentTransaction.blockHeight,
                contractInformation,
            );

            if (!vmEvaluator) {
                throw new Error('VM evaluator not found');
            }

            const feeBitcoin: bigint =
                contractDeploymentTransaction.burnedFee + contractDeploymentTransaction.reward;
            if (!feeBitcoin) {
                throw new Error('execution reverted (out of gas)');
            }

            // Trace the execution time
            const maxGas: bigint = this.calculateMaxGas(false, feeBitcoin, baseGas);

            const params: ExecutionParameters = {
                contractAddressStr: contractDeploymentTransaction.contractAddress,
                contractAddress: contractDeploymentTransaction.address,
                txOrigin: contractDeploymentTransaction.from,
                msgSender: contractDeploymentTransaction.from,

                callStack: [],
                maxGas: maxGas,
                calldata: contractDeploymentTransaction.calldata,

                blockHash: blockHash,
                blockNumber: blockHeight,
                blockMedian: median,

                transactionId: contractDeploymentTransaction.transactionId,
                transactionHash: contractDeploymentTransaction.hash,
                storage: new AddressMap(),
                preloadStorage: new AddressMap(),

                externalCall: false,
                gasUsed: 0n,
                callDepth: 0,
                contractDeployDepth: 1,
                //deployedContracts: [contractInformation], // TODO: Understand what is going on when using this. (cause db conflicts)
                isConstructor: true,

                inputs: contractDeploymentTransaction.strippedInputs,
                outputs: contractDeploymentTransaction.strippedOutputs,

                serializedInputs: undefined,
                serializedOutputs: undefined,

                preloadStorageList: contractDeploymentTransaction.preloadStorageList,
            };

            const execution = await vmEvaluator.execute(params);
            this.isProcessing = false;

            return execution;
        } catch (e) {
            this.isProcessing = false;

            throw e;
        }
    }

    public updateBlockValuesFromResult(
        evaluation: ContractEvaluation | undefined | null,
        contractAddress: Address,
        transactionId: string,
        disableStorageCheck: boolean = this.config.OP_NET.DISABLE_SCANNED_BLOCK_STORAGE_CHECK,
    ): void {
        if (this.isExecutor) {
            return;
        }

        if (!this.blockState) {
            throw new Error('Block state not found');
        }

        if (!this.receiptState) {
            throw new Error('Receipt state not found');
        }

        if (!transactionId) {
            throw new Error('Transaction ID not found');
        }

        let saved: boolean = false;
        if (evaluation) {
            const result = evaluation.getEvaluationResult();

            if (!evaluation.revert && result.result) {
                if (!result.changedStorage) throw new Error('Changed storage not found');

                for (const [contract, val] of result.changedStorage) {
                    this.blockState.updateValues(contract, val);
                }

                this.receiptState.updateValue(contractAddress, transactionId, result.result);

                saved = true;
            }
        }

        if (!saved) {
            // we store 0 (revert.)
            this.receiptState.updateValue(contractAddress, transactionId, new Uint8Array(1));
        }

        if (!disableStorageCheck) {
            this.blockState.generateTree();
        }
    }

    public async updateEvaluatedStates(): Promise<EvaluatedStates> {
        if (!this.blockState) {
            throw new Error('Block state not found');
        }

        if (!this.receiptState) {
            throw new Error('Receipt state not found');
        }

        await this.updateReceiptState();

        this.blockState.freeze();

        await this.saveBlockStateChanges();

        const states: EvaluatedStates = {
            storage: this.blockState,
            receipts: this.receiptState,
        };

        this.blockState = undefined;
        this.receiptState = undefined;

        return states;
    }

    public async saveBlock(block: Block): Promise<void> {
        if (this.config.DEBUG_LEVEL >= DebugLevel.TRACE) {
            this.debug(`Saving block ${block.height}...`);
        }

        if (block.height !== this.vmBitcoinBlock.height) {
            throw new Error('Block height mismatch');
        }

        await this.saveBlockHeader(block);
    }

    public async clear(): Promise<void> {
        this.blockState = undefined;
        this.receiptState = undefined;

        this.pointerCache.clear();
        this.contractAddressCache.clear();
        this._blockHeaderValidator.clear();
        this.verifiedBlockHeights.clear();
        this.contractCache.clear();

        for (const vmEvaluator of this.vmEvaluators.values()) {
            await vmEvaluator;
        }

        this.vmEvaluators.clear();
    }

    private calculateMaxGas(isSimulation: boolean, gasInSat: bigint, baseGas: bigint): bigint {
        const gas: bigint = isSimulation
            ? OPNetConsensus.consensus.GAS.TRANSACTION_MAX_GAS
            : GasTracker.convertSatToGas(
                  gasInSat,
                  OPNetConsensus.consensus.GAS.TRANSACTION_MAX_GAS,
                  OPNetConsensus.consensus.GAS.SAT_TO_GAS_RATIO,
              );

        const gasToScale = BlockGasPredictor.toBaseBigInt(gas);
        return gasToScale / baseGas; // Round down.
    }

    private async callExternal(
        params: InternalContractCallParameters,
    ): Promise<ContractEvaluation> {
        params.allowCached = !this.isExecutor;

        const result = await this.executeCallInternal(params);
        if (!result.result) {
            throw new Error(`execution reverted (external call: ${result.revert})`);
        }

        return result;
    }

    private async getVMEvaluatorFromParams(
        contractAddress: Address,
        blockHeight: bigint,
        contract?: ContractInformation,
    ): Promise<ContractEvaluator | null> {
        return await this.getVMEvaluator(contractAddress, blockHeight, contract).catch(
            (e: unknown) => {
                this.warn(`Error getting VM evaluator: ${e as Error}`);
                return null;
            },
        );
    }

    private async executeCallInternal(
        params: InternalContractCallParameters,
    ): Promise<ContractEvaluation> {
        let vmEvaluator: ContractEvaluator | null = null;

        if (params.deployedContracts) {
            for (const contract of params.deployedContracts) {
                if (contract.contractTweakedPublicKey.equals(params.contractAddress)) {
                    vmEvaluator = await this.getVMEvaluatorFromParams(
                        params.contractAddress,
                        params.blockHeight,
                        contract,
                    );
                    break;
                }
            }
        }

        // Get the function selector
        const calldata: Buffer = params.calldata;
        if (calldata.byteLength < 4) {
            throw new Error('Calldata too short');
        }

        if (!vmEvaluator) {
            vmEvaluator = params.allowCached
                ? await this.getVMEvaluatorFromCache(
                      params.contractAddress,
                      this.vmBitcoinBlock.height || params.blockHeight,
                  )
                : (vmEvaluator = await this.getVMEvaluatorFromParams(
                      params.contractAddress,
                      params.blockHeight,
                  ));
        }

        if (!vmEvaluator) {
            throw new Error(
                `[executeTransaction] Unable to initialize contract ${params.contractAddress}`,
            );
        }

        // we define the caller here.
        const caller: Address = params.msgSender || params.from;
        const executionParams: ExecutionParameters = {
            contractAddress: params.contractAddress,
            contractAddressStr: params.contractAddressStr,
            calldata: params.calldata,
            msgSender: caller,
            txOrigin: params.txOrigin,
            maxGas: params.maxGas,
            gasUsed: params.gasUsed,
            externalCall: params.externalCall,

            blockHash: params.blockHash,
            blockNumber: params.blockHeight,
            blockMedian: params.blockMedian,

            transactionId: params.transactionId,
            transactionHash: params.transactionHash,

            contractDeployDepth: params.contractDeployDepth,
            callDepth: params.callDepth,

            storage: params.storage,
            preloadStorage: params.preloadStorage,
            callStack: params.callStack || [],
            isConstructor: false,

            inputs: params.inputs,
            outputs: params.outputs,

            serializedInputs: params.serializedInputs,
            serializedOutputs: params.serializedOutputs,

            accessList: params.accessList,
            preloadStorageList: params.preloadStorageList,
        };

        // Execute the function
        const evaluation: ContractEvaluation | null = await vmEvaluator.execute(executionParams);

        /** Delete the contract to prevent damage on states. */
        if (!evaluation) {
            const error: string = 'execution reverted (evaluation)';
            throw new Error(error);
        }

        return evaluation;
    }

    private async getContractAddress(
        potentialContractAddress: string,
    ): Promise<Address | undefined> {
        let address: Address | undefined = this.contractAddressCache.get(potentialContractAddress);
        if (!address) {
            address = await this.vmStorage.getContractAddressAt(potentialContractAddress);

            if (address) this.contractAddressCache.set(potentialContractAddress, address);
        }

        return address;
    }

    private convertAPIBlockHeaderToBlockHeader(block: BlockHeaderAPIBlockDocument): BlockHeader {
        return {
            ...block,
            hash: Buffer.from(block.hash, 'hex'),
            height: BigInt(block.height),
        };
    }

    private async getChainCurrentBlockHeight(): Promise<BlockHeader> {
        const block = await this.vmStorage.getLatestBlock();
        if (!block) {
            throw new Error('Block not found');
        }

        setTimeout(() => {
            this.cachedLastBlockHeight = undefined;
        }, 2000);

        return this.convertAPIBlockHeaderToBlockHeader(block);
    }

    private async fetchCachedBlockHeight(): Promise<BlockHeader> {
        if (this.cachedLastBlockHeight === undefined) {
            this.cachedLastBlockHeight = this.getChainCurrentBlockHeight();
        }

        return this.cachedLastBlockHeight;
    }

    private generateAddress(salt: Buffer, deployer: Address, bytecode: Buffer): Address {
        const contractTweakedPublicKey = TapscriptVerificator.getContractSeed(
            bitcoin.crypto.hash256(Buffer.from(deployer)),
            bytecode,
            salt,
        );

        return new Address(contractTweakedPublicKey);
    }

    private async deployContractAtAddress(
        address: Address,
        salt: Buffer,
        evaluation: ContractEvaluation,
    ): Promise<
        | {
              contractAddress: Address;
              bytecodeLength: number;
          }
        | undefined
    > {
        if (address === evaluation.contractAddress) {
            throw new Error('Can not deploy itself.');
        }

        const contractInfo = await this.getContractInformation(address, evaluation.blockNumber);
        if (!contractInfo) {
            throw new Error('Contract not found');
        }

        const deployResult = this.generateAddress(
            salt,
            evaluation.contractAddress,
            contractInfo.bytecode,
        );

        if (this.contractCache.has(deployResult)) {
            throw new Error('Contract already deployed. (cache)');
        }

        const exists = await this.vmStorage.getContractAt(
            deployResult.toHex(),
            evaluation.blockNumber + 1n,
        );

        if (exists) {
            return Promise.resolve({
                contractAddress: new Address(new Array(32).fill(0)),
                bytecodeLength: 0,
            });
        }

        const deployerKeyPair = contractInfo.contractTweakedPublicKey;
        const bytecodeLength: number = contractInfo.bytecode.byteLength;

        const contractSaltHash = bitcoin.crypto.hash256(salt);
        const contractInformation: ContractInformation = new ContractInformation(
            evaluation.blockNumber,
            deployResult.p2tr(this.network),
            deployResult,
            deployResult.toTweakedHybridPublicKeyBuffer(),
            contractInfo.bytecode,
            false,
            evaluation.transactionId || Buffer.alloc(32),
            evaluation.transactionHash || Buffer.alloc(32),
            Buffer.from(deployerKeyPair),
            salt,
            contractSaltHash,
            evaluation.contractAddress,
        );

        evaluation.addContractInformation(contractInformation);

        return {
            contractAddress: deployResult,
            bytecodeLength: bytecodeLength,
        };
    }

    private async deployContractFromInfo(contractInformation: ContractInformation): Promise<void> {
        if (this.isExecutor) {
            // Emulators dont deploy contracts.
            return;
        }

        if (
            !contractInformation.deployedTransactionId ||
            !contractInformation.deployedTransactionHash
        ) {
            this.panic(
                'SHOULD NOT HAPPEN -> Transaction id or hash not found in executor mode. [deployContractAtAddress]',
            );

            throw new Error(
                'Transaction id or hash not found in executor mode. [deployContractAtAddress]',
            );
        }

        await this.setContractAt(contractInformation);
    }

    private async getVMEvaluator(
        contractAddress: Address,
        height: bigint,
        contractInformation?: ContractInformation,
    ): Promise<ContractEvaluator | null> {
        if (!contractInformation) {
            contractInformation = await this.getContractInformation(contractAddress, height);
        }

        if (!contractInformation) {
            return null;
        }

        const vmEvaluator = new ContractEvaluator(this.network);
        vmEvaluator.getStorage = this.getStorage.bind(this);
        vmEvaluator.getStorageMultiple = this.getStorageMultiple.bind(this);
        vmEvaluator.setStorage = this.setStorage.bind(this);
        vmEvaluator.callExternal = this.callExternal.bind(this);
        vmEvaluator.deployContractAtAddress = this.deployContractAtAddress.bind(this);
        vmEvaluator.deployContract = this.deployContractFromInfo.bind(this);
        vmEvaluator.setContractInformation(contractInformation);

        return vmEvaluator;
    }

    private async getVMEvaluatorFromCache(
        contractAddress: Address,
        height: bigint,
    ): Promise<ContractEvaluator | null> {
        const vmEvaluator: Promise<ContractEvaluator | null> | undefined =
            this.vmEvaluators.get(contractAddress);

        if (vmEvaluator) {
            return vmEvaluator;
        }

        const newVmEvaluator = this.getVMEvaluator(contractAddress, height);

        // This was move on top of the error on purpose. It prevents timeout during initialization for faster processing.
        this.vmEvaluators.set(contractAddress, newVmEvaluator);

        const value: ContractEvaluator | null = await newVmEvaluator;
        if (!value) {
            throw new Error(
                `[getVMEvaluatorFromCache] Unable to initialize contract ${contractAddress}`,
            );
        }

        return value;
    }

    private async updateReceiptState(): Promise<void> {
        if (!this.receiptState) {
            throw new Error('Receipt state not found');
        }

        const lastChecksum: string | undefined =
            await this._blockHeaderValidator.getPreviousBlockChecksumOfHeight(
                this.vmBitcoinBlock.height,
            );

        if (lastChecksum) {
            this.receiptState.updateValue(
                BTC_FAKE_ADDRESS,
                MAX_HASH,
                Buffer.from(lastChecksum, 'hex'),
            );
        } else {
            this.receiptState.updateValue(BTC_FAKE_ADDRESS, MAX_HASH, Buffer.alloc(0));
        }

        this.receiptState.updateValue(BTC_FAKE_ADDRESS, MAX_MINUS_ONE, Buffer.from([1])); // version
        this.receiptState.freeze();
    }

    private async getContractInformation(
        contractAddress: Address,
        height: bigint | undefined,
    ): Promise<ContractInformation | undefined> {
        if (this.contractCache.has(contractAddress)) {
            return this.contractCache.get(contractAddress);
        }

        const contractInformation: ContractInformation | undefined =
            await this.vmStorage.getContractAt(contractAddress.toHex(), height);

        if (contractInformation) {
            this.contractCache.set(contractAddress, contractInformation);
        }

        return contractInformation;
    }

    private async setContractAt(contractData: ContractInformation): Promise<void> {
        this.contractCache.set(contractData.contractTweakedPublicKey, contractData);

        await this.vmStorage.setContractAt(contractData);
    }

    private async saveBlockHeader(block: Block): Promise<void> {
        await this.vmStorage.saveBlockHeader(block.getBlockHeaderDocument());
    }

    /** We must save the final state changes to the storage */
    private async saveBlockStateChanges(): Promise<void> {
        if (this.isExecutor) {
            throw new Error('Executor can not save block state changes.');
        }

        if (!this.blockState) {
            throw new Error('Block state not found');
        }

        const stateChanges = this.blockState.getEverythingWithProofs();

        /** Nothing to save. */
        if (!stateChanges) return;

        const storageToUpdate: AddressMap<Map<StoragePointer, [MemoryValue, string[]]>> =
            new AddressMap();

        for (const [address, val] of stateChanges) {
            for (const [key, value] of val.entries()) {
                if (value[0] === undefined || value[0] === null) {
                    throw new Error(
                        `Value (${value[0]}) not found in state changes. Key ${key.toString()}`,
                    );
                }

                const pointer: StoragePointer = BufferHelper.pointerToUint8Array(key);
                const data: MemoryValue = BufferHelper.valueToUint8Array(value[0]);

                const storage =
                    storageToUpdate.get(address) ||
                    (new Map() as Map<StoragePointer, [MemoryValue, string[]]>);

                if (!storageToUpdate.has(address)) {
                    storageToUpdate.set(address, storage);
                }

                storage.set(pointer, [data, value[1]]);
            }
        }

        if (storageToUpdate.size) {
            await this.vmStorage.setStoragePointers(storageToUpdate, this.vmBitcoinBlock.height);
        }
    }

    /** We must ENSURE that NOTHING get modified EVEN during the execution of the block. This is performance costly but required. */
    private setStorage(address: Address, pointer: bigint, value: bigint): void {
        if (this.isExecutor) {
            return;
        }

        /** We must internally change the corresponding storage */
        if (!this.blockState) {
            throw new Error('Block state not found');
        }

        this.blockState.updateValue(address, pointer, value);
    }

    private async getStorageFromDB(
        address: Address,
        pointer: StoragePointer,
        defaultValue: MemoryValue | null = null,
        setIfNotExit: boolean = true,
        blockNumber: bigint,
    ): Promise<{ memory?: MemoryValue; proven?: ProvenMemoryValue } | null> {
        const valueFromDB = await this.vmStorage.getStorage(
            address,
            pointer,
            defaultValue,
            setIfNotExit,
            blockNumber,
        );

        if (valueFromDB == undefined) {
            return null;
        }

        if (valueFromDB.lastSeenAt === 0n) {
            return {
                memory: valueFromDB.value,
            };
        } else {
            return {
                proven: {
                    value: valueFromDB.value,
                    proofs: valueFromDB.proofs,
                    lastSeenAt: valueFromDB.lastSeenAt,
                },
            };
        }
    }

    private getPointerFromCache(
        address: Address,
        pointer: MemorySlotData<bigint>,
    ): [Uint8Array, string[]] | undefined | null {
        const addressCache = this.pointerCache.get(address);
        if (addressCache === undefined) return undefined;

        return addressCache.get(pointer) || undefined;
    }

    private storePointerInCache(
        address: Address,
        pointer: bigint,
        value: [Uint8Array, string[]] | null,
    ): void {
        let addressCache = this.pointerCache.get(address);
        if (!addressCache) {
            addressCache = new Map();
            this.pointerCache.set(address, addressCache);
        }

        addressCache.set(pointer, value);
    }

    private async processMemoryValue(
        address: Address,
        pointer: Uint8Array,
        provenMemoryValue: ProvenMemoryValue | null,
        blockNumber: bigint,
    ): Promise<ProvenMemoryValue | null> {
        // If the pointer is null, we set the value to 0 (new Uint8Array(32))
        //    with no proofs. In single-pointer getStorage, a null indicates “not found”,
        //    but here the requirement says “If a pointer is null, we set it to 0.”
        if (!provenMemoryValue) {
            return {
                value: new Uint8Array(32),
                proofs: [],
                lastSeenAt: blockNumber,
            };
        }

        // If we skip proof validation in certain cases:
        if (
            OPNetConsensus.consensus.TRANSACTIONS
                .SKIP_PROOF_VALIDATION_FOR_EXECUTION_BEFORE_TRANSACTION
        ) {
            // If skipping, just return as is.
            // Notice that in getStorage we returned just the .value, but here
            // we do want the full ProvenMemoryValue structure for multiple pointers.
            return provenMemoryValue;
        }

        // If proofs array is empty => data corruption
        if (provenMemoryValue.proofs.length === 0) {
            throw new Error(
                `[DATA CORRUPTED] Proofs not found for pointer ${pointer} at address ${address}.`,
            );
        }

        // Store in local cache
        const pointerBigInt = BufferHelper.uint8ArrayToPointer(pointer);
        this.storePointerInCache(address, pointerBigInt, [
            provenMemoryValue.value,
            provenMemoryValue.proofs,
        ]);

        // Verify proofs
        const isValid: boolean = await this.verifyProofs(
            pointer,
            provenMemoryValue.value,
            provenMemoryValue.proofs,
            provenMemoryValue.lastSeenAt,
        );

        if (!isValid) {
            this.error(
                `[DATA CORRUPTED] Proofs not valid for pointer ${pointer} at address ${address}. Data corrupted. Please reindex your indexer from scratch.`,
            );
            throw new Error(
                `[DATA CORRUPTED] Proofs not valid for pointer ${pointer} at address ${address}. MUST REINDEX FROM SCRATCH.`,
            );
        }

        return provenMemoryValue;
    }

    private async getStorageMultiple(
        pointerList: AddressMap<Uint8Array[]>,
        blockNumber: bigint,
    ): Promise<ProvenPointers | null> {
        // Must check if we have the value in the current block state
        if (!this.blockState && !this.isExecutor) {
            throw new Error('Block state not found');
        }

        // Ask vmStorage for all pointers in bulk
        const pointersResult: ProvenPointers | null = await this.vmStorage.getStorageMultiple(
            pointerList,
            blockNumber,
        );

        if (!pointersResult) {
            return null;
        }

        // For each address & pointer, verify proofs (or set to 0 if null)
        for (const [address, pointerMap] of pointersResult.entries()) {
            for (const [pointerKey, provenVal] of pointerMap.entries()) {
                // We reuse the same logic from getStorage via a helper method
                const updatedVal = await this.processMemoryValue(
                    address,
                    pointerKey,
                    provenVal,
                    blockNumber,
                );

                pointerMap.set(pointerKey, updatedVal);
            }
        }

        return pointersResult;
    }

    /** We must verify that the storage is correct */
    private async getStorage(
        address: Address,
        pointer: StoragePointer,
        defaultValue: MemoryValue | null = null,
        setIfNotExit: boolean = true,
        blockNumber: bigint,
    ): Promise<MemoryValue | null> {
        // Ensure we have a block state (as in the original code).
        if (!this.blockState && !this.isExecutor) {
            throw new Error('Block state not found');
        }

        const pointerBigInt: bigint = BufferHelper.uint8ArrayToPointer(pointer);

        // Try to get from blockState or from the in-memory pointer cache
        const pointerValueFromState =
            this.blockState?.getValueWithProofs(address, pointerBigInt) ||
            this.getPointerFromCache(address, pointerBigInt);

        // If blockState or cache specifically says "null" => pointer not found => return null
        // (This is different from getStorageMultiple, which sets 0 if pointer is null.)
        if (pointerValueFromState === null) {
            return null;
        }

        let provenMemoryValue: ProvenMemoryValue | null = null;

        // If pointerValueFromState === undefined => not in blockState or cache => must load from DB
        if (pointerValueFromState === undefined) {
            const result = await this.getStorageFromDB(
                address,
                pointer,
                defaultValue,
                setIfNotExit,
                blockNumber,
            );

            // If no DB result => treat as "not found"
            if (!result) return null;
            if (result.memory) {
                // "Direct memory" returns a MemoryValue
                return result.memory;
            } else if (result.proven) {
                provenMemoryValue = result.proven;
            } else {
                throw new Error(`[DATA CORRUPTED] Proofs not found for ${pointer} at ${address}.`);
            }
        } else {
            // pointerValueFromState is a 2-tuple [Uint8Array, string[]]
            // But if we skip proofs => just return the raw memory
            if (
                OPNetConsensus.consensus.TRANSACTIONS
                    .SKIP_PROOF_VALIDATION_FOR_EXECUTION_BEFORE_TRANSACTION
            ) {
                return pointerValueFromState[0];
            } else {
                // Construct a full provenMemoryValue from the blockState pointer
                provenMemoryValue = {
                    value: pointerValueFromState[0],
                    proofs: pointerValueFromState[1],
                    lastSeenAt: this.vmBitcoinBlock.height,
                };
            }
        }

        // If for some reason provenMemoryValue is still null => "not found"
        if (!provenMemoryValue) {
            return null;
        }

        // Reuse the same logic we use in getStorageMultiple
        const verifiedMemoryValue = await this.processMemoryValue(
            address,
            pointer,
            provenMemoryValue,
            blockNumber,
        );

        // Return just the MemoryValue part
        return verifiedMemoryValue?.value || null;
    }

    private async verifyProofs(
        encodedPointer: Uint8Array,
        value: MemoryValue,
        proofs: string[],
        blockHeight: bigint,
    ): Promise<boolean> {
        if (blockHeight === this.vmBitcoinBlock.height) {
            if (!this.blockState) {
                throw new Error('Block state not found');
            }

            if (
                !this.config.OP_NET.DISABLE_SCANNED_BLOCK_STORAGE_CHECK &&
                !this.blockState.hasTree()
            ) {
                throw new Error(
                    `Tried to verify the value of a state without a valid tree. Block height: ${blockHeight} - Current height: ${this.vmBitcoinBlock.height} (Have this block been saved already?)`,
                );
            }

            // Same block.
            return this.config.OP_NET.DISABLE_SCANNED_BLOCK_STORAGE_CHECK
                ? true
                : StateMerkleTree.verify(this.blockState.root, [encodedPointer, value], proofs);
        }

        /** We must get the block root states */
        const blockHeaders: BlockHeaderDocument | null | undefined =
            await this._blockHeaderValidator.getBlockHeader(blockHeight);

        if (blockHeaders === null) {
            throw new Error(
                `This should never happen. Block 0 can not verify any past state history.`,
            );
        }

        if (!blockHeaders) {
            throw new Error(
                `Block root states not found for block ${blockHeight}. DATA CORRUPTED.`,
            );
        }

        const isVerifiedBlock: boolean = await this.verifyBlockAtHeight(blockHeight, blockHeaders);
        if (!isVerifiedBlock) {
            throw new Error(`Block ${blockHeight} have altered headers. DATA CORRUPTED.`);
        }

        // We must verify the proofs from the block root states.
        return StateMerkleTree.verify(blockHeaders.storageRoot, [encodedPointer, value], proofs);
    }

    private async verifyBlockAtHeight(
        blockHeight: bigint,
        blockHeaders: BlockHeaderDocument,
    ): Promise<boolean> {
        const verifiedHeight: Promise<boolean> =
            this.verifiedBlockHeights.get(blockHeight) ||
            this._verifyBlockAtHeight(blockHeight, blockHeaders);

        this.verifiedBlockHeights.set(blockHeight, verifiedHeight);

        return await verifiedHeight;
    }

    /** We verify that the block did not get altered at the given height. */
    private async _verifyBlockAtHeight(
        height: bigint,
        blockHeaders: BlockHeaderDocument,
    ): Promise<boolean> {
        if (height !== DataConverter.fromDecimal128(blockHeaders.height)) {
            throw new Error('Block height mismatch');
        }

        if (this.config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug(`Validating block ${height} headers...`);
        }

        return this._blockHeaderValidator.validateBlockChecksum(blockHeaders);
    }
}
