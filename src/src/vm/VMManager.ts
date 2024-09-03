import {
    Address,
    BinaryReader,
    BufferHelper,
    DeterministicMap,
    Selector,
} from '@btc-vision/bsi-binary';
import { DebugLevel, Globals, Logger } from '@btc-vision/bsi-common';
import { DataConverter } from '@btc-vision/bsi-db';
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
import { WrapTransaction } from '../blockchain-indexer/processor/transaction/transactions/WrapTransaction.js';
import {
    ExecutionParameters,
    InternalContractCallParameters,
} from './runtime/types/InternalContractCallParameters.js';
import { ContractEvaluation } from './runtime/classes/ContractEvaluation.js';
import { GasTracker } from './runtime/GasTracker.js';
import { OPNetConsensus } from '../poa/configurations/OPNetConsensus.js';
import { AddressGenerator, EcKeyPair, TapscriptVerificator } from '@btc-vision/transaction';
import bitcoin from 'bitcoinjs-lib';
import { NetworkConverter } from '../config/network/NetworkConverter.js';
import { contractManager } from './isolated/RustContract.js';

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

    private readonly network: bitcoin.Network;
    private currentRequest:
        | {
              to: Address;
              from: Address;
              calldataString: string;
              height?: bigint;
          }
        | undefined;

    constructor(
        private readonly config: IBtcIndexerConfig,
        private readonly isExecutor: boolean = false,
        vmStorage?: VMStorage,
    ) {
        super();

        this.network = NetworkConverter.getNetwork();

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

    public async saveTransactions(
        transactions: ITransactionDocument<OPNetTransactionTypes>[],
    ): Promise<void> {
        await this.vmStorage.saveTransactions(transactions);
    }

    public async init(): Promise<void> {
        await this.vmStorage.init();

        this.initiated = true;
    }

    public async closeDatabase(): Promise<void> {
        await this.vmStorage.close();
        await this.clear();
    }

    public purgeAllContractInstances(): void {
        try {
            contractManager.destroyAll();
        } catch (e) {
            this.panic(`Error purging contract instances: ${e}`);
        }
    }

    public async prepareBlock(blockId: bigint): Promise<void> {
        this.purgeAllContractInstances();

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
            throw new Error(`VM is already processing: ${JSON.stringify(this.currentRequest)}`);
        }

        this.currentRequest = {
            to,
            from,
            calldataString,
            height,
        };

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
                maxGas: OPNetConsensus.consensus.TRANSACTIONS.EMULATION_MAX_GAS,
                calldata: Buffer.from(calldataString, 'hex'),
                blockHeight: currentHeight,
                storage: new DeterministicMap(BinaryReader.stringCompare),
                blockMedian: BigInt(Date.now()), // add support for this
                allowCached: true,
                externalCall: false,
                gasUsed: 0n,
                callDepth: 0,
                contractDeployDepth: 0,
                transactionId: null,
                transactionHash: null,
            };

            // Execute the function
            const evaluation = await this.executeCallInternal(params);
            const result = evaluation.getEvaluationResult();
            this.isProcessing = false;

            if (result.revert) {
                throw result.revert;
            }

            return result;
        } catch (e) {
            this.isProcessing = false;
            throw e;
        }
    }

    public async executeTransaction(
        blockHeight: bigint,
        blockMedian: bigint,
        interactionTransaction: InteractionTransaction | WrapTransaction,
        unlimitedGas: boolean = false,
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
            const maxGas: bigint = unlimitedGas
                ? OPNetConsensus.consensus.TRANSACTIONS.MAX_GAS
                : GasTracker.convertSatToGas(
                      burnedBitcoins,
                      OPNetConsensus.consensus.TRANSACTIONS.MAX_GAS,
                      OPNetConsensus.consensus.TRANSACTIONS.SAT_TO_GAS_RATIO,
                  );

            // Define the parameters for the internal call.
            const params: InternalContractCallParameters = {
                contractAddress: contractAddress,
                from: interactionTransaction.from,
                callee: interactionTransaction.callee,
                maxGas: maxGas,
                calldata: interactionTransaction.calldata,
                blockHeight: blockHeight,
                blockMedian: blockMedian,
                transactionId: interactionTransaction.transactionId,
                transactionHash: interactionTransaction.hash,
                storage: new DeterministicMap(BinaryReader.stringCompare),
                allowCached: true,
                externalCall: false,
                gasUsed: 0n,
                callDepth: 0,
                contractDeployDepth: 0,
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
            await vmEvaluator;
        }

        this.vmEvaluators.clear();
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
        return await this.getVMEvaluator(contractAddress, blockHeight, contract).catch((e) => {
            this.warn(`Error getting VM evaluator: ${e as Error}`);
            return null;
        });
    }

    private async executeCallInternal(
        params: InternalContractCallParameters,
    ): Promise<ContractEvaluation> {
        let vmEvaluator: ContractEvaluator | null = null;

        // We have to convert virtual address to segwit address.
        if (params.contractAddress && params.contractAddress.startsWith('0x')) {
            const buffer = Buffer.from(params.contractAddress.slice(2), 'hex');
            params.contractAddress = AddressGenerator.generatePKSH(buffer, this.network);
        }

        if (params.deployedContracts) {
            for (let contract of params.deployedContracts) {
                if (
                    contract.contractAddress === params.contractAddress ||
                    contract.virtualAddress === params.contractAddress
                ) {
                    vmEvaluator = await this.getVMEvaluatorFromParams(
                        params.contractAddress,
                        params.blockHeight,
                        contract,
                    );
                    break;
                }
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
            throw new Error(
                `[executeTransaction] Unable to initialize contract ${params.contractAddress}`,
            );
        }

        // Get the function selector
        const calldata: Buffer = params.calldata;
        if (calldata.byteLength < 4) {
            throw new Error('Calldata too short');
        }

        const finalBuffer: Buffer = Buffer.alloc(calldata.byteLength - 4);
        calldata.copy(finalBuffer, 0, 4, calldata.byteLength);

        const selector: Selector = calldata.readUInt32BE(0);
        const isView: boolean = vmEvaluator.isViewMethod(selector);

        if (this.config.DEBUG_LEVEL >= DebugLevel.TRACE) {
            this.debugBright(
                `Executing function selector ${selector} (IsReadOnly: ${isView}) for contract ${params.contractAddress} at block ${params.blockHeight || 'latest'} with calldata ${calldata.toString(
                    'hex',
                )}`,
            );
        }

        // we define the caller here.
        const caller: Address = params.from;
        const executionParams: ExecutionParameters = {
            contractAddress: params.contractAddress,
            isView: isView,
            abi: selector,
            calldata: finalBuffer,
            caller: caller,
            callee: params.callee,
            maxGas: params.maxGas,
            gasUsed: params.gasUsed,
            externalCall: params.externalCall,
            blockNumber: params.blockHeight,
            blockMedian: params.blockMedian,
            contractDeployDepth: params.contractDeployDepth,
            callDepth: params.callDepth,
            transactionId: params.transactionId,
            transactionHash: params.transactionHash,
            storage: params.storage,
            callStack: params.callStack || [],
        };

        // Execute the function
        const evaluation: ContractEvaluation | null = await vmEvaluator.execute(executionParams);
        /*.catch(async (e) => {
            if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                const error = (await e) as Error;

                this.panic(`Evaluation failed: ${error}`);
            }

            return null;
        });*/

        // Executors can not save block state changes.
        if (!params.externalCall && params.transactionId) {
            this.updateBlockValuesFromResult(
                evaluation,
                params.contractAddress,
                params.transactionId,
                this.config.OP_NET.DISABLE_SCANNED_BLOCK_STORAGE_CHECK,
            );
        }

        /** Delete the contract to prevent damage on states. */
        if (!evaluation) {
            let error: string = 'execution reverted (evaluation)';
            throw new Error(error);
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

    private generateAddress(
        salt: Buffer,
        deployer: Address,
        bytecode: Buffer,
    ): {
        contractAddress: Address;
        virtualAddress: Buffer;
    } {
        const contractVirtualAddress = TapscriptVerificator.getContractSeed(
            bitcoin.crypto.hash256(Buffer.from(deployer, 'utf-8')),
            bytecode, // TODO: Maybe precompute that on deployment?
            salt,
        );

        /** Generate contract segwit address */
        const contractSegwitAddress = AddressGenerator.generatePKSH(
            contractVirtualAddress,
            this.network,
        );

        return { contractAddress: contractSegwitAddress, virtualAddress: contractVirtualAddress };
    }

    private async deployContractAtAddress(
        address: Address,
        salt: Buffer,
        evaluation: ContractEvaluation,
    ): Promise<
        | {
              contractAddress: Address;
              virtualAddress: Buffer;
              bytecodeLength: bigint;
          }
        | undefined
    > {
        if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
            this.log(
                `This contract (${evaluation.contractAddress}) wants to redeploy ${address}. Salt: ${salt.toString('hex')}`,
            );
        }

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

        if (this.contractCache.has(deployResult.contractAddress)) {
            throw new Error('Contract already deployed. (cache)');
        }

        const exists = await this.vmStorage.getContractAt(
            deployResult.contractAddress,
            evaluation.blockNumber + 1n,
        );

        if (exists) {
            throw new Error(
                `Contract already deployed (${deployResult.contractAddress} as ${deployResult.virtualAddress.toString('hex')}). (db)`,
            );
        }

        const deployerKeyPair = EcKeyPair.fromSeedKeyPair(
            Buffer.from(contractInfo.virtualAddress.replace('0x', ''), 'hex'),
        );

        const bytecodeLength: bigint = BigInt(contractInfo.bytecode.byteLength);
        // TODO: ADD GAS COST
        /*evaluation.gasTracker.addGas(
            bytecodeLength * OPNetConsensus.consensus.TRANSACTIONS.STORAGE_COST_PER_BYTE,
        );*/

        const contractSaltHash = bitcoin.crypto.hash256(salt);
        const contractInformation: ContractInformation = new ContractInformation(
            evaluation.blockNumber,
            deployResult.contractAddress,
            `0x${deployResult.virtualAddress.toString('hex')}`,
            null,
            contractInfo.bytecode,
            false,
            evaluation.transactionId || '',
            evaluation.transactionHash || '',
            deployerKeyPair.publicKey,
            salt,
            contractSaltHash,
            evaluation.contractAddress,
        );

        evaluation.addContractInformation(contractInformation);

        return {
            ...deployResult,
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

        if (this.config.DEBUG_LEVEL >= DebugLevel.INFO) {
            this.info(`Contract ${contractInformation.contractAddress} deployed.`);
        }
    }

    private async getVMEvaluator(
        contractAddress: Address,
        height: bigint,
        contractInformation?: ContractInformation | undefined,
    ): Promise<ContractEvaluator | null> {
        if (!contractInformation) {
            contractInformation = await this.getContractInformation(contractAddress, height);
        }

        if (!contractInformation) {
            return null;
        }

        const vmEvaluator = new ContractEvaluator(this.network);
        vmEvaluator.getStorage = this.getStorage.bind(this);
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
        contractAddress: Address,
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

        let storageToUpdate: Map<Address, Map<StoragePointer, [MemoryValue, string[]]>> = new Map();

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
    private async setStorage(address: Address, pointer: bigint, value: bigint): Promise<void> {
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

        if (!valueFromDB) {
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

    /** We must verify that the storage is correct */
    private async getStorage(
        address: Address,
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

            if (!result) return null;

            if (result?.memory) return result.memory;

            if (result?.proven) {
                memoryValue = result.proven;
            } else {
                throw new Error(`[DATA CORRUPTED] Proofs not found for ${pointer} at ${address}.`);
            }
        } else if (
            OPNetConsensus.consensus.TRANSACTIONS
                .SKIP_PROOF_VALIDATION_FOR_EXECUTION_BEFORE_TRANSACTION
        ) {
            return BufferHelper.valueToUint8Array(valueBigInt[0]);
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

        if (this.config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug(`Validating block ${height} headers...`);
        }

        return this.validateBlockChecksum(blockHeaders);
    }
}
