import { Address, ADDRESS_BYTE_LENGTH, BufferHelper, Selector } from '@btc-vision/bsi-binary';
import { DebugLevel, Globals, Logger } from '@btc-vision/bsi-common';
import { DataConverter } from '@btc-vision/bsi-db';
import { BitcoinAddress } from '../bitcoin/types/BitcoinAddress.js';
import { Block } from '../blockchain-indexer/processor/block/Block.js';
import { ChecksumMerkle } from '../blockchain-indexer/processor/block/merkle/ChecksumMerkle.js';
import { ReceiptMerkleTree } from '../blockchain-indexer/processor/block/merkle/ReceiptMerkleTree.js';
import { StateMerkleTree } from '../blockchain-indexer/processor/block/merkle/StateMerkleTree.js';
import {
    MAX_HASH,
    MAX_MINUS_ONE,
    ZERO_HASH,
} from '../blockchain-indexer/processor/block/types/ZeroValue.js';
import { ContractInformation } from '../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { OPNetTransactionTypes } from '../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { DeploymentTransaction } from '../blockchain-indexer/processor/transaction/transactions/DeploymentTransaction.js';
import { InteractionTransaction } from '../blockchain-indexer/processor/transaction/transactions/InteractionTransaction.js';
import { IBtcIndexerConfig } from '../config/interfaces/IBtcIndexerConfig.js';
import {
    BlockHeaderBlockDocument,
    BlockHeaderChecksumProof,
} from '../db/interfaces/IBlockHeaderBlockDocument.js';
import { ITransactionDocument } from '../db/interfaces/ITransactionDocument.js';
import { EvaluatedResult } from './evaluated/EvaluatedResult.js';
import { EvaluatedStates } from './evaluated/EvaluatedStates.js';
import { ContractEvaluator } from './runtime/ContractEvaluator.js';
import { VMMongoStorage } from './storage/databases/VMMongoStorage.js';
import { IndexerStorageType } from './storage/types/IndexerStorageType.js';
import { MemoryValue, ProvenMemoryValue } from './storage/types/MemoryValue.js';
import { StoragePointer } from './storage/types/StoragePointer.js';
import { VMStorage } from './storage/VMStorage.js';
import { VMBitcoinBlock } from './VMBitcoinBlock.js';
import { VMIsolator } from './VMIsolator.js';
import { WrapTransaction } from '../blockchain-indexer/processor/transaction/transactions/WrapTransaction.js';
import {
    ExecutionParameters,
    InternalContractCallParameters,
} from './runtime/types/InternalContractCallParameters.js';
import { ContractEvaluation } from './runtime/classes/ContractEvaluation.js';
import { GasTracker } from './runtime/GasTracker.js';

Globals.register();

export class VMManager extends Logger {
    public initiated: boolean = false;

    private readonly vmStorage: VMStorage;
    private readonly vmBitcoinBlock: VMBitcoinBlock;

    private blockState: StateMerkleTree | undefined;
    private receiptState: ReceiptMerkleTree | undefined;

    private cachedBlockHeader: Map<bigint, BlockHeaderBlockDocument> = new Map();
    private verifiedBlockHeights: Map<bigint, Promise<boolean>> = new Map();
    private contractCache: Map<string, ContractInformation> = new Map();

    private vmEvaluators: Map<Address, Promise<ContractEvaluator>> = new Map();
    private contractAddressCache: Map<Address, Address> = new Map();
    private cachedLastBlockHeight: Promise<bigint> | undefined;
    private isProcessing: boolean = false;

    constructor(
        private readonly config: IBtcIndexerConfig,
        private readonly isExecutor: boolean = false,
        vmStorage?: VMStorage,
    ) {
        super();

        this.vmStorage = vmStorage || this.getVMStorage();
        this.vmBitcoinBlock = new VMBitcoinBlock(this.vmStorage);
        this.contractCache = new Map();
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

    public async init(): Promise<void> {
        await this.vmStorage.init();

        this.initiated = true;
    }

    public async closeDatabase(): Promise<void> {
        await this.vmStorage.close();
        await this.clear();
    }

    public async prepareBlock(blockId: bigint): Promise<void> {
        if (this.config.DEBUG_LEVEL >= DebugLevel.TRACE) {
            this.debug(`Preparing block ${blockId}...`);
        }

        await this.clear();

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
        } catch (e) {
            await this.vmBitcoinBlock.revert();
        }

        await this.clear();
    }

    public async saveTransactions(
        blockHeight: bigint,
        transaction: ITransactionDocument<OPNetTransactionTypes>[],
    ): Promise<void> {
        if (this.vmBitcoinBlock.height !== blockHeight) {
            throw new Error('Block height mismatch');
        }

        await this.vmStorage.saveTransactions(blockHeight, transaction);
    }

    public async loadContractFromBytecode(
        contractAddress: string,
        contractBytecode: Buffer,
    ): Promise<{ isolator: VMIsolator; errored: boolean }> {
        const isolator = new VMIsolator(contractAddress, contractBytecode);
        isolator.getStorage = this.getStorage.bind(this);
        isolator.setStorage = this.setStorage.bind(this);
        isolator.callExternal = this.callExternal.bind(this);

        let errored = await isolator.setupJail();

        return {
            isolator,
            errored,
        };
    }

    public busy(): boolean {
        return this.isProcessing;
    }

    /** This method is allowed to read only. It can not modify any states. */
    public async execute(
        to: Address,
        from: Address,
        calldataString: string,
        height?: bigint,
    ): Promise<EvaluatedResult> {
        if (this.isProcessing) {
            throw new Error('VM is already processing');
        }

        try {
            this.isProcessing = true;

            const currentHeight: bigint = height || 1n + (await this.fetchCachedBlockHeight());
            const contractAddress: Address | undefined = await this.getContractAddress(to);
            if (!contractAddress) {
                throw new Error('Contract not found');
            }

            // Get the contract evaluator
            const params: InternalContractCallParameters = {
                contractAddress: contractAddress,
                from: from,
                callee: from,
                maxGas: GasTracker.MAX_GAS,
                calldata: Buffer.from(calldataString, 'hex'),
                blockHeight: currentHeight,
                allowCached: true,
                externalCall: false,
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
        blockHeight: bigint,
        interactionTransaction: InteractionTransaction | WrapTransaction,
    ): Promise<EvaluatedResult> {
        if (this.isProcessing) {
            throw new Error('VM is already processing');
        }

        try {
            const start = Date.now();
            if (this.vmBitcoinBlock.height !== blockHeight) {
                throw new Error('Block height mismatch');
            }

            const contractAddress: Address | undefined = await this.getContractAddress(
                interactionTransaction.contractAddress,
            );

            if (!contractAddress) {
                throw new Error('Contract not found');
            }

            // If the interaction is using the p2tr address, we must change it to the segwit address.
            if (interactionTransaction.contractAddress !== contractAddress) {
                interactionTransaction.contractAddress = contractAddress;
            }

            if (this.config.DEBUG_LEVEL >= DebugLevel.TRACE) {
                this.debugBright(
                    `Attempting to execute transaction for contract ${contractAddress}`,
                );
            }

            const burnedBitcoins: bigint = interactionTransaction.burnedFee;
            if (!burnedBitcoins) {
                throw new Error('execution reverted (out of gas)');
            }

            // Trace the execution time
            const startBeforeExecution = Date.now();
            const maxGas: bigint = GasTracker.convertSatToGas(burnedBitcoins);

            // Define the parameters for the internal call.
            const params: InternalContractCallParameters = {
                contractAddress: contractAddress,
                from: interactionTransaction.from,
                callee: interactionTransaction.callee,
                maxGas: maxGas,
                calldata: interactionTransaction.calldata,
                blockHeight: blockHeight,
                transactionId: interactionTransaction.transactionId,
                allowCached: true,
                externalCall: false,
            };

            const result: ContractEvaluation = await this.executeCallInternal(params);
            if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                this.debug(
                    `Executed transaction ${interactionTransaction.txid} for contract ${contractAddress}. (Took ${startBeforeExecution - start}ms to initialize, ${Date.now() - startBeforeExecution}ms to execute, ${result.gasUsed} gas used)`,
                );
            }

            const response = result.getEvaluationResult();
            this.isProcessing = false;

            return response;
        } catch (e) {
            this.isProcessing = false;
            throw e;
        }
    }

    public updateBlockValuesFromResult(
        result: EvaluatedResult,
        contractAddress: BitcoinAddress,
        disableStorageCheck: boolean = this.config.OP_NET.DISABLE_SCANNED_BLOCK_STORAGE_CHECK,
        transactionId?: string,
    ): void {
        if (!this.blockState) {
            throw new Error('Block state not found');
        }

        if (!this.receiptState) {
            throw new Error('Receipt state not found');
        }

        const resultValue: Uint8Array | undefined = result.result;
        if (!resultValue) {
            throw new Error('execution reverted.');
        }

        for (const [contract, val] of result.changedStorage) {
            /*if (contract !== contractAddress) {
                throw new Error(
                    `Possible attack detected: Contract ${contract} tried to change storage of ${contractAddress}`,
                );
            }*/

            this.blockState.updateValues(contract, val);
        }

        if (transactionId && result.result) {
            this.receiptState.updateValue(contractAddress, transactionId, result.result);
        }

        if (!disableStorageCheck) {
            this.blockState.generateTree();
        }
    }

    /** TODO: Move this method to an other class and use this method when synchronizing block headers once PoA is implemented. */
    public async validateBlockChecksum(
        blockHeader: Partial<BlockHeaderBlockDocument>,
    ): Promise<boolean> {
        if (!blockHeader.checksumRoot || blockHeader.height === undefined) {
            throw new Error('Block checksum not found');
        }

        const prevBlockHash: string | undefined = blockHeader.previousBlockHash;
        const prevBlockChecksum: string | undefined = blockHeader.previousBlockChecksum;

        const blockHeight: bigint = DataConverter.fromDecimal128(blockHeader.height);
        const blockReceipt: string | undefined = blockHeader.receiptRoot;
        const blockStorage: string | undefined = blockHeader.storageRoot;
        const blockHash: string | undefined = blockHeader.hash;
        const blockMerkelRoot: string | undefined = blockHeader.merkleRoot;
        const checksumRoot: string | undefined = blockHeader.checksumRoot;
        const proofs: BlockHeaderChecksumProof | undefined = blockHeader.checksumProofs;

        if (
            blockHeight === null ||
            blockHeight === undefined ||
            !blockReceipt ||
            !blockStorage ||
            !blockHash ||
            !blockMerkelRoot ||
            !proofs ||
            !checksumRoot
        ) {
            throw new Error('Block data not found');
        }

        const previousBlockChecksum: string | undefined =
            await this.getPreviousBlockChecksumOfHeight(blockHeight);

        if (!previousBlockChecksum) {
            throw new Error('Previous block checksum not found');
        }

        if (prevBlockChecksum !== previousBlockChecksum) {
            if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                this.fail(
                    `Previous block checksum mismatch for block ${blockHeight} (${prevBlockChecksum} !== ${previousBlockChecksum})`,
                );
            }

            return false;
        }

        /** We must validate the block checksum */
        const prevHashValue: [number, Uint8Array] = [
            0,
            prevBlockHash ? BufferHelper.hexToUint8Array(prevBlockHash) : new Uint8Array(32),
        ];

        const prevHashProof = this.getProofForIndex(proofs, 0);
        const hasValidPrevHash: boolean = ChecksumMerkle.verify(
            checksumRoot,
            ChecksumMerkle.TREE_TYPE,
            prevHashValue,
            prevHashProof,
        );

        const prevChecksumProof = this.getProofForIndex(proofs, 1);
        const hasValidPrevChecksum: boolean = ChecksumMerkle.verify(
            checksumRoot,
            ChecksumMerkle.TREE_TYPE,
            [1, BufferHelper.hexToUint8Array(previousBlockChecksum)],
            prevChecksumProof,
        );

        const blockHashProof = this.getProofForIndex(proofs, 2);
        const hasValidBlockHash: boolean = ChecksumMerkle.verify(
            checksumRoot,
            ChecksumMerkle.TREE_TYPE,
            [2, BufferHelper.hexToUint8Array(blockHash)],
            blockHashProof,
        );

        const blockMerkelRootProof = this.getProofForIndex(proofs, 3);
        const hasValidBlockMerkelRoot: boolean = ChecksumMerkle.verify(
            checksumRoot,
            ChecksumMerkle.TREE_TYPE,
            [3, BufferHelper.hexToUint8Array(blockMerkelRoot)],
            blockMerkelRootProof,
        );

        const blockStorageProof = this.getProofForIndex(proofs, 4);
        const hasValidBlockStorage: boolean = ChecksumMerkle.verify(
            checksumRoot,
            ChecksumMerkle.TREE_TYPE,
            [4, BufferHelper.hexToUint8Array(blockStorage)],
            blockStorageProof,
        );

        const blockReceiptProof = this.getProofForIndex(proofs, 5);
        const hasValidBlockReceipt: boolean = ChecksumMerkle.verify(
            checksumRoot,
            ChecksumMerkle.TREE_TYPE,
            [5, BufferHelper.hexToUint8Array(blockReceipt)],
            blockReceiptProof,
        );

        return (
            hasValidPrevHash &&
            hasValidPrevChecksum &&
            hasValidBlockHash &&
            hasValidBlockMerkelRoot &&
            hasValidBlockStorage &&
            hasValidBlockReceipt
        );
    }

    public async getPreviousBlockChecksumOfHeight(height: bigint): Promise<string | undefined> {
        const newBlockHeight: bigint = height - 1n;
        if (newBlockHeight < BigInt(this.config.OP_NET.ENABLED_AT_BLOCK)) {
            return ZERO_HASH;
        }

        const blockRootStates: BlockHeaderBlockDocument | undefined =
            await this.getBlockHeader(newBlockHeight);

        if (!blockRootStates) {
            return;
        }

        if (!blockRootStates.checksumRoot) {
            throw new Error('Invalid previous block checksum.');
        }

        return blockRootStates.checksumRoot;
    }

    public async deployContract(
        blockHeight: bigint,
        contractDeploymentTransaction: DeploymentTransaction,
    ): Promise<void> {
        if (this.vmBitcoinBlock.height !== blockHeight) {
            throw new Error('Block height mismatch');
        }

        if (!contractDeploymentTransaction.p2trAddress) {
            throw new Error('Contract address not found');
        }

        if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
            this.debugBright(
                `Attempting to deploy contract ${contractDeploymentTransaction.p2trAddress}`,
            );
        }

        const contractInformation: ContractInformation = ContractInformation.fromTransaction(
            blockHeight,
            contractDeploymentTransaction,
        );

        // We must save the contract information
        await this.setContractAt(contractInformation);

        if (this.config.DEBUG_LEVEL >= DebugLevel.INFO) {
            this.info(`Contract ${contractInformation.contractAddress} deployed.`);
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

    public async getBlockHeader(height: bigint): Promise<BlockHeaderBlockDocument | undefined> {
        if (this.cachedBlockHeader.has(height)) {
            return this.cachedBlockHeader.get(height);
        }

        const blockHeader: BlockHeaderBlockDocument | undefined =
            await this.vmStorage.getBlockHeader(height);

        if (blockHeader) {
            this.cachedBlockHeader.set(height, blockHeader);
        }

        return blockHeader;
    }

    public async clear(): Promise<void> {
        this.blockState = undefined;
        this.receiptState = undefined;

        this.contractAddressCache.clear();
        this.cachedBlockHeader.clear();
        this.verifiedBlockHeights.clear();
        this.contractCache.clear();

        for (let vmEvaluator of this.vmEvaluators.values()) {
            const evaluator = await vmEvaluator;
            if (evaluator) {
                evaluator.clear();
                evaluator.dispose();
            }
        }

        this.vmEvaluators.clear();
    }

    private async callExternal(
        params: InternalContractCallParameters,
    ): Promise<ContractEvaluation> {
        params.allowCached = !this.isExecutor;

        const result = await this.executeCallInternal(params);
        if (!result.result) {
            throw new Error('execution reverted (external call)');
        }

        return result;
    }

    private async executeCallInternal(
        params: InternalContractCallParameters,
    ): Promise<ContractEvaluation> {
        // Get the contract evaluator
        const vmEvaluator: ContractEvaluator | null = params.allowCached
            ? await this.getVMEvaluatorFromCache(
                  params.contractAddress,
                  this.vmBitcoinBlock.height || params.blockHeight,
              )
            : await this.getVMEvaluator(params.contractAddress, params.blockHeight).catch(() => {
                  return null;
              });

        if (!vmEvaluator) {
            throw new Error(
                `[executeTransaction] Unable to initialize contract ${params.contractAddress}`,
            );
        }

        await vmEvaluator.setMaxGas(params.maxGas, params.gasUsed);

        // Get the function selector
        const calldata: Buffer = params.calldata;
        if (calldata.byteLength < 4) {
            throw new Error('Calldata too short');
        }

        const finalBuffer: Buffer = Buffer.alloc(calldata.byteLength - 4);
        calldata.copy(finalBuffer, 0, 4, calldata.byteLength);

        const selector: Selector = calldata.readUInt32BE(0);
        const isView: boolean = vmEvaluator.isViewMethod(selector);

        if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
            this.debugBright(
                `Executing function selector ${selector} (IsReadOnly: ${isView}) for contract ${params.contractAddress} at block ${params.blockHeight || 'latest'} with calldata ${calldata.toString(
                    'hex',
                )}`,
            );
        }

        // we define the caller here.
        const caller: Address = params.from;

        let error: string = 'execution reverted';

        const executionParams: ExecutionParameters = {
            contractAddress: params.contractAddress,
            isView: isView,
            abi: selector,
            calldata: finalBuffer,
            caller: caller,
            callee: params.callee,
            externalCall: params.externalCall,
            blockNumber: params.blockHeight,
        };

        // Execute the function
        const evaluation: ContractEvaluation | null = await vmEvaluator
            .execute(executionParams)
            .catch((e) => {
                console.log(e);

                const errorMsg: string = e instanceof Error ? e.message : (e as string);
                if (errorMsg && errorMsg.includes('out of gas') && errorMsg.length < 60) {
                    error = `execution reverted (${errorMsg})`;
                } else {
                    error = `execution reverted (gas used: ${vmEvaluator.getGasUsed})`;
                }

                if (this.config.DEBUG_LEVEL >= DebugLevel.TRACE) {
                    this.error(
                        `Error executing function selector ${selector} for contract ${params.contractAddress} at block ${params.blockHeight || 'latest'} with calldata ${calldata.toString('hex')}: ${e}`,
                    );
                }

                return null;
            });

        if (!evaluation) {
            await this.resetContractVM(vmEvaluator);

            throw new Error(error);
        }

        const result = evaluation.getEvaluationResult();

        /** Reset contract to prevent damage on states. TODO: Add concurrence to initialisation. */
        if (!result) {
            await this.resetContractVM(vmEvaluator);

            throw new Error(error);
        }

        // Executors can not save block state changes.
        if (!this.isExecutor && !params.externalCall && params.transactionId) {
            this.updateBlockValuesFromResult(
                result,
                params.contractAddress,
                this.config.OP_NET.DISABLE_SCANNED_BLOCK_STORAGE_CHECK,
                params.transactionId,
            );
        }

        // Clear the VM evaluator if we are not allowing cached.
        if (!params.allowCached) {
            vmEvaluator.clear();
            vmEvaluator.dispose();
        }

        return evaluation;
    }

    private async getContractAddress(
        potentialContractAddress: Address,
    ): Promise<Address | undefined> {
        let address: Address | undefined = this.contractAddressCache.get(potentialContractAddress);
        if (!address) {
            address = await this.vmStorage.getContractAddressAt(potentialContractAddress);

            if (address) this.contractAddressCache.set(potentialContractAddress, address);
        }

        return address;
    }

    private async resetContractVM(vmEvaluator: ContractEvaluator): Promise<void> {
        await vmEvaluator.preventDamage();
    }

    private async getChainCurrentBlockHeight(): Promise<bigint> {
        const block = await this.vmStorage.getLatestBlock();
        if (!block) {
            throw new Error('Block not found');
        }

        setTimeout(() => {
            this.cachedLastBlockHeight = undefined;
        }, 2000);

        return BigInt(block.height);
    }

    private async fetchCachedBlockHeight(): Promise<bigint> {
        if (this.cachedLastBlockHeight === undefined) {
            this.cachedLastBlockHeight = this.getChainCurrentBlockHeight();
        }

        return this.cachedLastBlockHeight;
    }

    private async getVMEvaluator(
        contractAddress: Address,
        height: bigint | undefined,
    ): Promise<ContractEvaluator | null> {
        // TODO: Add a caching layer for this.
        const contractInformation: ContractInformation | undefined =
            await this.getContractInformation(contractAddress, height);

        if (!contractInformation) {
            this.warn(`Could not get contract ${contractAddress}.`);
            return null;
        }

        const vmIsolatorObj: { isolator: VMIsolator; errored: boolean } =
            await this.loadContractFromBytecode(contractAddress, contractInformation.bytecode);

        if (vmIsolatorObj.errored) {
            throw new Error(`Failed to load contract ${contractAddress} bytecode. (errored)`);
        }

        const vmIsolator: VMIsolator | null = vmIsolatorObj.isolator;
        if (!vmIsolator) {
            throw new Error(`Failed to load contract ${contractAddress} bytecode. (isolator)`);
        }

        const vmEvaluator = vmIsolator.getContract();
        if (!vmEvaluator) {
            throw new Error(`Failed to load contract ${contractAddress} bytecode. (evaluator)`);
        }

        // We use pub the pub key as the deployer address.
        const contractDeployer: string = contractInformation.deployerAddress;
        if (!contractDeployer || contractDeployer.length > ADDRESS_BYTE_LENGTH) {
            throw new Error(`Invalid contract deployer "${contractDeployer}"`);
        }

        await vmEvaluator.setupContract(contractDeployer, contractAddress);
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

        const newVmEvaluator = this.getVMEvaluator(contractAddress, height).catch(() => {
            return null;
        });

        // This was move on top of the error on purpose. It prevents timeout during initialization for faster processing.
        this.vmEvaluators.set(contractAddress, newVmEvaluator as Promise<ContractEvaluator>);

        if (!newVmEvaluator) {
            throw new Error(
                `[getVMEvaluatorFromCache] Unable to initialize contract ${contractAddress}`,
            );
        }

        return newVmEvaluator as Promise<ContractEvaluator>;
    }

    private async updateReceiptState(): Promise<void> {
        if (!this.receiptState) {
            throw new Error('Receipt state not found');
        }

        const lastChecksum: string | undefined = await this.getPreviousBlockChecksumOfHeight(
            this.vmBitcoinBlock.height,
        );

        if (lastChecksum) {
            this.receiptState.updateValue(MAX_HASH, MAX_HASH, Buffer.from(lastChecksum, 'hex'));
        } else {
            this.receiptState.updateValue(MAX_HASH, MAX_HASH, Buffer.alloc(0));
        }

        this.receiptState.updateValue(MAX_MINUS_ONE, MAX_MINUS_ONE, Buffer.from([1])); // version
        this.receiptState.freeze();
    }

    private async getContractInformation(
        contractAddress: BitcoinAddress,
        height: bigint | undefined,
    ): Promise<ContractInformation | undefined> {
        if (this.contractCache.has(contractAddress)) {
            return this.contractCache.get(contractAddress);
        }

        const contractInformation: ContractInformation | undefined =
            await this.vmStorage.getContractAt(contractAddress, height);

        if (contractInformation) {
            this.contractCache.set(contractAddress, contractInformation);
        }

        return contractInformation;
    }

    private async setContractAt(contractData: ContractInformation): Promise<void> {
        this.contractCache.set(contractData.contractAddress, contractData);

        await this.vmStorage.setContractAt(contractData);
    }

    private getProofForIndex(proofs: BlockHeaderChecksumProof, index: number): string[] {
        for (const proof of proofs) {
            if (proof[0] === index) {
                return proof[1];
            }
        }

        throw new Error(`Proof not found for index ${index}`);
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

        let storageToUpdate: Map<
            BitcoinAddress,
            Map<StoragePointer, [MemoryValue, string[]]>
        > = new Map();

        for (const [address, val] of stateChanges.entries()) {
            for (const [key, value] of val.entries()) {
                if (value[0] === undefined || value[0] === null) {
                    throw new Error(
                        `Value (${value[0]}) not found in state changes. Key ${key.toString()}`,
                    );
                }

                const pointer: StoragePointer = BufferHelper.pointerToUint8Array(key);
                const data: MemoryValue = BufferHelper.valueToUint8Array(value[0]);

                /*await this.vmStorage.setStorage(
                    address,
                    pointer,
                    data,
                    value[1],
                    this.vmBitcoinBlock.height,
                );*/

                const storage = storageToUpdate.get(address) || new Map();
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
    private async setStorage(
        address: BitcoinAddress,
        pointer: StoragePointer,
        value: MemoryValue,
    ): Promise<void> {
        if (this.isExecutor) {
            return;
        }

        /** We must internally change the corresponding storage */
        if (!this.blockState) {
            throw new Error('Block state not found');
        }

        const pointerBigInt: bigint = BufferHelper.uint8ArrayToPointer(pointer);
        const valueBigInt: bigint = BufferHelper.uint8ArrayToValue(value);

        this.blockState.updateValue(address, pointerBigInt, valueBigInt);
    }

    private async getStorageFromDB(
        address: BitcoinAddress,
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

        if (!valueFromDB) {
            return null;
        }

        if (valueFromDB.lastSeenAt === 0n) {
            // Default value.
            //await this.setStorage(address, pointer, valueFromDB.value);

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

    /** We must verify that the storage is correct */
    private async getStorage(
        address: BitcoinAddress,
        pointer: StoragePointer,
        defaultValue: MemoryValue | null = null,
        setIfNotExit: boolean = true,
        blockNumber: bigint,
    ): Promise<MemoryValue | null> {
        /** We must check if we have the value in the current block state */
        if (!this.blockState && !this.isExecutor) {
            throw new Error('Block state not found');
        }

        const pointerBigInt: bigint = BufferHelper.uint8ArrayToPointer(pointer);
        const valueBigInt = this.blockState?.getValueWithProofs(address, pointerBigInt);

        let memoryValue: ProvenMemoryValue | null;
        if (!valueBigInt) {
            const result = await this.getStorageFromDB(
                address,
                pointer,
                defaultValue,
                setIfNotExit,
                blockNumber,
            );

            if (result?.memory) return result.memory;

            if (result?.proven) {
                memoryValue = result.proven;
            } else {
                throw new Error(`[DATA CORRUPTED] Proofs not found for ${pointer} at ${address}.`);
            }
        } else {
            memoryValue = {
                value: BufferHelper.valueToUint8Array(valueBigInt[0]),
                proofs: valueBigInt[1],
                lastSeenAt: this.vmBitcoinBlock.height,
            };
        }

        if (memoryValue.proofs.length === 0) {
            this.error(`[DATA CORRUPTED] Proofs not found for ${pointer} at ${address}.`);

            throw new Error(`[DATA CORRUPTED] Proofs not found for ${pointer} at ${address}.`);
        }

        const encodedPointer = StateMerkleTree.encodePointerBuffer(address, pointer);

        // We must verify the proofs.
        const isValid: boolean = await this.verifyProofs(
            encodedPointer,
            memoryValue.value,
            memoryValue.proofs,
            memoryValue.lastSeenAt,
        );

        /** TODO: Add auto repair */
        if (!isValid) {
            this.error(
                `[DATA CORRUPTED] Proofs not valid for ${pointer} at ${address}. Data corrupted. Please reindex your indexer from scratch.`,
            );

            throw new Error(
                `[DATA CORRUPTED] Proofs not valid for ${pointer} at ${address}. MUST REINDEX FROM SCRATCH.`,
            );
        }

        return memoryValue?.value || null;
    }

    private async verifyProofs(
        encodedPointer: Buffer,
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
                : StateMerkleTree.verify(
                      this.blockState.root,
                      StateMerkleTree.TREE_TYPE,
                      [encodedPointer, value],
                      proofs,
                  );
        }

        /** We must get the block root states */
        const blockHeaders: BlockHeaderBlockDocument | undefined =
            await this.getBlockHeader(blockHeight);

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
        return StateMerkleTree.verify(
            blockHeaders.storageRoot,
            StateMerkleTree.TREE_TYPE,
            [encodedPointer, value],
            proofs,
        );
    }

    private async verifyBlockAtHeight(
        blockHeight: bigint,
        blockHeaders: BlockHeaderBlockDocument,
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
        blockHeaders: BlockHeaderBlockDocument,
    ): Promise<boolean> {
        if (height !== DataConverter.fromDecimal128(blockHeaders.height)) {
            throw new Error('Block height mismatch');
        }

        if (this.config.DEBUG_LEVEL >= DebugLevel.TRACE) {
            this.debug(`Validating block ${height} headers...`);
        }

        return this.validateBlockChecksum(blockHeaders);
    }
}
