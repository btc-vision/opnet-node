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
import { init } from '@btc-vision/op-vm';

Globals.register();

init();

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

    private pointerCache: AddressMap<Map<MemorySlotData<bigint>, ProvenMemoryValue | null>> =
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

            const gasTracker = this.getGasTracker(
                OPNetConsensus.consensus.GAS.EMULATION_MAX_GAS,
                0n,
            );

            // Get the contract evaluator
            const params: InternalContractCallParameters = {
                contractAddressStr: contractAddress.p2tr(this.network),
                contractAddress: contractAddress,
                from: from,
                txOrigin: from,

                gasTracker,
                calldata: calldata,

                blockHeight: height == undefined ? currentHeight.height + 1n : currentHeight.height,
                blockMedian: median, // add support for this

                storage: new AddressMap(),
                preloadStorage: new AddressMap(),

                allowCached: false,
                externalCall: false,
                isDeployment: false,

                callStack: undefined,
                contractDeployDepth: undefined,

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
            const gasTracker = this.getGasTracker(maxGas, 0n);

            // Define the parameters for the internal call.
            const params: InternalContractCallParameters = {
                contractAddressStr: interactionTransaction.contractAddress,
                contractAddress: contractAddress,

                from: interactionTransaction.from,
                txOrigin: interactionTransaction.txOrigin,
                msgSender: interactionTransaction.msgSender,

                gasTracker,
                calldata: interactionTransaction.calldata,

                blockHash: blockHash,
                blockHeight: blockHeight,
                blockMedian: blockMedian,

                transactionId: interactionTransaction.transactionId,
                transactionHash: interactionTransaction.hash,

                storage: new AddressMap(),
                preloadStorage: new AddressMap(),
                isDeployment: false,

                callStack: undefined,
                allowCached: true,
                externalCall: false,
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

            const deployedContracts: AddressMap<ContractInformation> = new AddressMap();
            deployedContracts.set(
                contractInformation.contractTweakedPublicKey,
                contractInformation,
            );

            const gasTracker = this.getGasTracker(maxGas, 0n);
            const params: ExecutionParameters = {
                contractAddressStr: contractDeploymentTransaction.contractAddress,
                contractAddress: contractDeploymentTransaction.address,
                txOrigin: contractDeploymentTransaction.from,
                msgSender: contractDeploymentTransaction.from,

                gasTracker,
                calldata: contractDeploymentTransaction.calldata,

                blockHash: blockHash,
                blockNumber: blockHeight,
                blockMedian: median,

                transactionId: contractDeploymentTransaction.transactionId,
                transactionHash: contractDeploymentTransaction.hash,
                storage: new AddressMap(),
                preloadStorage: new AddressMap(),

                externalCall: false,
                memoryPagesUsed: 0n,
                contractDeployDepth: 1,
                deployedContracts: deployedContracts,
                callStack: undefined,
                touchedAddresses: undefined,

                isDeployment: true,

                inputs: contractDeploymentTransaction.strippedInputs,
                outputs: contractDeploymentTransaction.strippedOutputs,

                serializedInputs: undefined,
                serializedOutputs: undefined,

                accessList: undefined,
                preloadStorageList: contractDeploymentTransaction.preloadStorageList,
            };

            const execution = await vmEvaluator.run(params);
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

    private getGasTracker(maxGas: bigint, usedGas: bigint): GasTracker {
        const gasTracker = new GasTracker(maxGas);
        gasTracker.setGasUsed(usedGas);

        return gasTracker;
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

        return await this.executeCallInternal(params);
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
            const contract = params.deployedContracts.get(params.contractAddress);

            if (contract) {
                vmEvaluator = await this.getVMEvaluatorFromParams(
                    params.contractAddress,
                    params.blockHeight,
                    contract,
                );
            }
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
            throw new Error(`OP_NET: Invalid contract.`);
        }

        // we define the caller here.
        const caller: Address = params.msgSender || params.from;
        const executionParams: ExecutionParameters = {
            contractAddress: params.contractAddress,
            contractAddressStr: params.contractAddressStr,
            calldata: params.calldata,
            msgSender: caller,
            txOrigin: params.txOrigin,
            gasTracker: params.gasTracker,
            externalCall: params.externalCall,

            blockHash: params.blockHash,
            blockNumber: params.blockHeight,
            blockMedian: params.blockMedian,

            transactionId: params.transactionId,
            transactionHash: params.transactionHash,

            contractDeployDepth: params.contractDeployDepth,

            deployedContracts: params.deployedContracts,
            memoryPagesUsed: params.memoryPagesUsed,
            touchedAddresses: params.touchedAddresses,

            storage: params.storage,
            preloadStorage: params.preloadStorage,
            callStack: params.callStack,
            isDeployment: params.isDeployment || false,

            inputs: params.inputs,
            outputs: params.outputs,

            serializedInputs: params.serializedInputs,
            serializedOutputs: params.serializedOutputs,

            accessList: params.accessList,
            preloadStorageList: params.preloadStorageList,
        };

        // Execute the function
        const evaluation: ContractEvaluation | null = await vmEvaluator.run(executionParams);

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
        pointerBigInt: bigint,
        blockNumber: bigint,
    ): Promise<{ memory?: MemoryValue; proven?: ProvenMemoryValue } | null> {
        const valueFromDB = await this.vmStorage.getStorage(address, pointer, blockNumber);
        this.storePointerInCache(address, pointerBigInt, valueFromDB);

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
    ): ProvenMemoryValue | undefined | null {
        const addressCache = this.pointerCache.get(address);
        if (addressCache === undefined) return undefined;

        return addressCache.get(pointer) || undefined;
    }

    private storePointerInCache(
        address: Address,
        pointer: bigint,
        value: ProvenMemoryValue | null,
    ): void {
        let addressCache = this.pointerCache.get(address);
        if (!addressCache) {
            addressCache = new Map();
            this.pointerCache.set(address, addressCache);
        }

        addressCache.set(pointer, value);
    }

    /**
     * Shared logic for:
     *  - Setting a pointer to zero if null (multi-pointer requirement)
     *  - Validating proofs (unless skipping)
     *  - Storing in the pointer cache
     */
    private async finalizeProvenMemoryValue(
        address: Address,
        pointer: Uint8Array,
        provenMemoryValue: ProvenMemoryValue | null,
        blockNumber: bigint,
        treatNullAsZero: boolean,
    ): Promise<ProvenMemoryValue | null> {
        // If pointer is null and we do NOT treat null as zero => just return null
        if (!provenMemoryValue && !treatNullAsZero) {
            return null;
        }

        // If pointer is null but we treat null as zero => build a default value
        const realValue: ProvenMemoryValue = provenMemoryValue || {
            value: new Uint8Array(32),
            proofs: [],
            lastSeenAt: blockNumber,
        };

        // Store in local cache
        const pointerBigInt = BufferHelper.uint8ArrayToPointer(pointer);
        this.storePointerInCache(address, pointerBigInt, realValue);

        // If skipping proof validation => just return as is
        if (
            OPNetConsensus.consensus.TRANSACTIONS
                .SKIP_PROOF_VALIDATION_FOR_EXECUTION_BEFORE_TRANSACTION
        ) {
            return realValue;
        }

        // If proof array is empty => data corrupted
        if (realValue.proofs.length === 0) {
            throw new Error(
                `[DATA CORRUPTED] Proofs not found for pointer ${pointer} at address ${address}.`,
            );
        }

        // Verify proofs
        const isValid: boolean = await this.verifyProofs(
            pointer,
            realValue.value,
            realValue.proofs,
            realValue.lastSeenAt,
        );

        if (!isValid) {
            this.error(
                `[DATA CORRUPTED] Proofs not valid for pointer ${pointer} at address ${address}. ` +
                    `Data corrupted. Please reindex your indexer from scratch.`,
            );
            throw new Error(
                `[DATA CORRUPTED] Proofs not valid for pointer ${pointer} at address ${address}. ` +
                    `MUST REINDEX FROM SCRATCH.`,
            );
        }

        return realValue;
    }

    private async getStorageMultiple(
        pointerList: AddressMap<Uint8Array[]>,
        blockNumber: bigint,
    ): Promise<ProvenPointers | null> {
        if (!this.blockState && !this.isExecutor) {
            throw new Error('Block state not found');
        }

        const pointersResult: ProvenPointers = new AddressMap();
        const realList: AddressMap<Uint8Array[]> = new AddressMap();

        // Preload from blockState/cache
        for (const [address, pointers] of pointerList.entries()) {
            const map = new Map<StoragePointer, ProvenMemoryValue | null>();
            const array: Uint8Array[] = [];

            for (const pointer of pointers) {
                const pointerBigInt = BufferHelper.uint8ArrayToPointer(pointer);
                const pointerValueFromState: [Uint8Array, string[]] | undefined | null =
                    this.getFromInternalCache(address, pointerBigInt);

                // We simply store "null" if it's not found. We'll fix that up to zero later,
                // inside finalizeProvenMemoryValue(treatNullAsZero = true).
                if (pointerValueFromState === null) {
                    map.set(pointer, null);
                } else if (pointerValueFromState !== undefined) {
                    // Convert [value, proofs] => a ProvenMemoryValue
                    map.set(pointer, {
                        value: pointerValueFromState[0],
                        proofs: pointerValueFromState[1],
                        lastSeenAt: this.vmBitcoinBlock.height,
                    });
                } else {
                    // pointerValueFromState === undefined => we will fetch from DB
                    array.push(pointer);
                }
            }

            pointersResult.set(address, map);
            realList.set(address, array);
        }

        const fetchedFromDB = await this.vmStorage.getStorageMultiple(realList, blockNumber);
        if (!fetchedFromDB) {
            return null;
        }

        for (const [addrFetched, pointerMap] of fetchedFromDB.entries()) {
            const existingMap =
                pointersResult.get(addrFetched) ||
                new Map<StoragePointer, ProvenMemoryValue | null>();

            for (const [ptrKey, provenVal] of pointerMap.entries()) {
                existingMap.set(ptrKey, provenVal);
            }
        }

        // Now finalize (verify proofs + store in cache + treatNullAsZero)
        for (const [address, pointerMap] of pointersResult.entries()) {
            for (const [pointerKey, provenVal] of pointerMap.entries()) {
                const verified = await this.finalizeProvenMemoryValue(
                    address,
                    pointerKey,
                    provenVal,
                    blockNumber,
                    false,
                );

                pointerMap.set(pointerKey, verified);
            }
        }

        return pointersResult;
    }

    private getFromInternalCache(
        address: Address,
        pointerBigInt: bigint,
    ): [Uint8Array, string[]] | undefined | null {
        // Try blockState or pointer cache
        let pointerValueFromState: [Uint8Array, string[]] | undefined | null =
            this.blockState?.getValueWithProofs(address, pointerBigInt);

        if (!pointerValueFromState) {
            const fromInternalCache = this.getPointerFromCache(address, pointerBigInt);

            if (fromInternalCache) {
                pointerValueFromState = [fromInternalCache.value, fromInternalCache.proofs];
            } else {
                pointerValueFromState = fromInternalCache;
            }
        }

        return pointerValueFromState;
    }

    /** We must verify that the storage is correct */
    private async getStorage(
        address: Address,
        pointer: StoragePointer,
        blockNumber: bigint,
        doNotLoad: boolean = false,
    ): Promise<MemoryValue | null> {
        if (!this.blockState && !this.isExecutor) {
            throw new Error('Block state not found');
        }

        const pointerBigInt: bigint = BufferHelper.uint8ArrayToPointer(pointer);
        const pointerValueFromState: [Uint8Array, string[]] | undefined | null =
            this.getFromInternalCache(address, pointerBigInt);

        let provenMemoryValue: ProvenMemoryValue | null = null;
        if (pointerValueFromState === null) {
            // Means we explicitly know "pointer not found"
            provenMemoryValue = null;
        } else if (pointerValueFromState === undefined) {
            if (doNotLoad) {
                return null;
            }

            // Means we don't know => must load from DB
            const result = await this.getStorageFromDB(
                address,
                pointer,
                pointerBigInt,
                blockNumber,
            );

            if (!result) {
                return null; // not found
            }

            if (result.memory) {
                // Direct memory found => skip proof checks, just return
                return result.memory;
            }

            // Otherwise, we have provenMemoryValue from DB
            if (result.proven) {
                provenMemoryValue = result.proven;
            } else {
                throw new Error(`[DATA CORRUPTED] Proofs not found for ${pointer} at ${address}.`);
            }
        } else {
            // pointerValueFromState is a 2‐tuple [value, proofs]
            if (
                OPNetConsensus.consensus.TRANSACTIONS
                    .SKIP_PROOF_VALIDATION_FOR_EXECUTION_BEFORE_TRANSACTION
            ) {
                return pointerValueFromState[0];
            }
            provenMemoryValue = {
                value: pointerValueFromState[0],
                proofs: pointerValueFromState[1],
                lastSeenAt: this.vmBitcoinBlock.height,
            };
        }

        // Pass provenMemoryValue (which might be null) into finalizeProvenMemoryValue
        const verified = await this.finalizeProvenMemoryValue(
            address,
            pointer,
            provenMemoryValue,
            blockNumber,
            false,
        );

        // If finalizeProvenMemoryValue returned null => pointer is truly not found
        if (!verified) {
            return null;
        }

        return verified.value;
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
