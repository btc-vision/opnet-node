import { ADDRESS_BYTE_LENGTH, BufferHelper, Selector } from '@btc-vision/bsi-binary';
import { DebugLevel, Globals, Logger } from '@btc-vision/bsi-common';
import { DataConverter } from '@btc-vision/bsi-db';
import fs from 'fs';
import { RunningScriptInNewContextOptions, Script, ScriptOptions } from 'vm';
import { BitcoinAddress } from '../bitcoin/types/BitcoinAddress.js';
import { Block } from '../blockchain-indexer/processor/block/Block.js';
import { ChecksumMerkle } from '../blockchain-indexer/processor/block/merkle/ChecksumMerkle.js';
import { ReceiptMerkleTree } from '../blockchain-indexer/processor/block/merkle/ReceiptMerkleTree.js';
import { StateMerkleTree } from '../blockchain-indexer/processor/block/merkle/StateMerkleTree.js';
import { MAX_HASH, ZERO_HASH } from '../blockchain-indexer/processor/block/types/ZeroValue.js';
import { ContractInformation } from '../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { OPNetTransactionTypes } from '../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { DeploymentTransaction } from '../blockchain-indexer/processor/transaction/transactions/DeploymentTransaction.js';
import { InteractionTransaction } from '../blockchain-indexer/processor/transaction/transactions/InteractionTransaction.js';
import { Config } from '../config/Config.js';
import { IBtcIndexerConfig } from '../config/interfaces/IBtcIndexerConfig.js';
import {
    BlockHeaderBlockDocument,
    BlockHeaderChecksumProof,
} from '../db/interfaces/IBlockHeaderBlockDocument.js';
import { ITransactionDocument } from '../db/interfaces/ITransactionDocument.js';
import { EvaluatedContext, VMContext } from './evaluated/EvaluatedContext.js';
import { EvaluatedResult } from './evaluated/EvaluatedResult.js';
import { EvaluatedStates } from './evaluated/EvaluatedStates.js';
import { ContractEvaluator } from './runtime/ContractEvaluator.js';
import { VMMongoStorage } from './storage/databases/VMMongoStorage.js';
import { IndexerStorageType } from './storage/types/IndexerStorageType.js';
import { MemoryValue, ProvenMemoryValue } from './storage/types/MemoryValue.js';
import { StoragePointer } from './storage/types/StoragePointer.js';
import { VMStorage } from './storage/VMStorage.js';
import { VMBitcoinBlock } from './VMBitcoinBlock.js';

Globals.register();

export class VMManager extends Logger {
    private readonly runtimeCode: string = fs
        .readFileSync(`${__dirname}/../../../build/src/vm/runtime/index.js`)
        .toString();

    private readonly vmStorage: VMStorage;
    private readonly vmBitcoinBlock: VMBitcoinBlock;

    private blockState: StateMerkleTree | undefined;
    private receiptState: ReceiptMerkleTree | undefined;

    private cachedBlockHeader: Map<bigint, BlockHeaderBlockDocument> = new Map();
    private verifiedBlockHeights: Map<bigint, Promise<boolean>> = new Map();
    private contractCache: Map<string, ContractInformation> = new Map();

    constructor(private readonly config: IBtcIndexerConfig) {
        super();

        this.vmStorage = this.getVMStorage();
        this.vmBitcoinBlock = new VMBitcoinBlock(this.vmStorage);
        this.contractCache = new Map();
    }

    public async init(): Promise<void> {
        await this.vmStorage.init();
    }

    public async closeDatabase(): Promise<void> {
        await this.vmStorage.close();
        this.clear();
    }

    public async prepareBlock(blockId: bigint): Promise<void> {
        this.clear();

        await this.vmBitcoinBlock.prepare(blockId);

        this.blockState = new StateMerkleTree();
        this.receiptState = new ReceiptMerkleTree();
    }

    public async revertBlock(): Promise<void> {
        await this.vmBitcoinBlock.revert();
        this.clear();
    }

    public async terminateBlock(block?: Block): Promise<void> {
        // TODO: Save block data
        try {
            if (block !== undefined) {
                await this.saveBlock(block);
            }

            await this.vmBitcoinBlock.terminate();
        } catch (e) {
            await this.vmBitcoinBlock.revert();
        }

        this.clear();
    }

    public async saveTransaction(
        blockHeight: bigint,
        transaction: ITransactionDocument<OPNetTransactionTypes>,
    ): Promise<void> {
        if (this.vmBitcoinBlock.height !== blockHeight) {
            throw new Error('Block height mismatch');
        }

        await this.vmStorage.saveTransaction(transaction);
    }

    public async loadContractFromBytecode(
        contractAddress: string,
        contractBytecode: Buffer,
    ): Promise<VMContext | null> {
        const contextOptions: EvaluatedContext = {
            context: {
                logs: [],
                errors: [],

                contract: null,

                getStorage: this.getStorage.bind(this),
                setStorage: this.setStorage.bind(this),

                rndPromise: this.rndPromise.bind(this),

                ContractEvaluator: ContractEvaluator,

                initialBytecode: contractBytecode,
                contractAddress: contractAddress,
            },
        };

        const scriptRunningOptions: RunningScriptInNewContextOptions = {
            timeout: 2000,
            contextCodeGeneration: {
                strings: false,
                wasm: false,
            },
        };

        const runtime: Script = this.createRuntimeVM();

        try {
            await runtime.runInNewContext(contextOptions, scriptRunningOptions);
        } catch (error) {
            console.log('Error:', error, contextOptions.context);
        }

        return contextOptions.context;
    }

    public async executeTransaction(
        blockHeight: bigint,
        interactionTransaction: InteractionTransaction,
    ): Promise<EvaluatedResult> {
        if (this.vmBitcoinBlock.height !== blockHeight) {
            throw new Error('Block height mismatch');
        }

        const contractAddress: BitcoinAddress = interactionTransaction.contractAddress;
        if (Config.DEBUG_LEVEL >= DebugLevel.TRACE) {
            this.debugBright(`Attempting to execute transaction for contract ${contractAddress}`);
        }

        // TODO: Add a caching layer for this.
        const contractInformation: ContractInformation | undefined =
            await this.getContractInformation(contractAddress);

        if (!contractInformation) {
            throw new Error(`Contract ${contractAddress} not found.`);
        }

        const vmContext: VMContext | null = await this.loadContractFromBytecode(
            contractAddress,
            contractInformation.bytecode,
        );

        if (!vmContext) {
            throw new Error(`Failed to load contract ${contractAddress} bytecode.`);
        }

        const vmEvaluator = vmContext.contract;
        if (!vmEvaluator) {
            throw new Error(`Failed to load contract ${contractAddress} bytecode.`);
        }

        // We use pub the pub key as the deployer address.
        const contractDeployer: string = contractInformation.deployerAddress;
        if (!contractDeployer || contractDeployer.length < ADDRESS_BYTE_LENGTH) {
            throw new Error(`Invalid contract deployer "${contractDeployer}"`);
        }

        await vmEvaluator.setupContract(contractDeployer, contractAddress);

        const isInitialized: boolean = vmEvaluator.isInitialized();
        if (!isInitialized) {
            throw new Error(`Unable to initialize contract ${contractAddress}`);
        }

        if (Config.DEBUG_LEVEL >= DebugLevel.TRACE) {
            this.debugBright(
                `Executing transaction ${interactionTransaction.txid} for contract ${contractAddress}`,
            );
        }

        // Get the function selector
        const calldata: Buffer = interactionTransaction.calldata;

        const finalBuffer: Buffer = Buffer.alloc(calldata.byteLength - 4);
        calldata.copy(finalBuffer, 0, 4, calldata.byteLength);

        const selector: Selector = calldata.readUInt32BE(0);
        const isView: boolean = vmEvaluator.isViewMethod(selector);
        if (Config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
            this.debugBright(
                `Executing function selector ${selector} (IsReadOnly: ${isView}) for contract ${contractAddress} at block ${blockHeight} with calldata ${calldata.toString(
                    'hex',
                )}`,
            );
        }

        // Execute the function
        const result: EvaluatedResult = await vmEvaluator.execute(
            contractAddress,
            isView,
            selector,
            finalBuffer,
            interactionTransaction.from,
        );

        if (!result) {
            throw new Error('Execution Reverted.');
        }

        this.updateBlockValuesFromResult(
            result,
            contractAddress,
            Config.OP_NET.DISABLE_SCANNED_BLOCK_STORAGE_CHECK,
            interactionTransaction.transactionId,
        );

        return result;
    }

    public updateBlockValuesFromResult(
        result: EvaluatedResult,
        contractAddress: BitcoinAddress,
        disableStorageCheck: boolean = Config.OP_NET.DISABLE_SCANNED_BLOCK_STORAGE_CHECK,
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
            throw new Error('Execution Reverted.');
        }

        for (const [contract, val] of result.changedStorage) {
            if (contract !== contractAddress) {
                throw new Error(
                    `Possible attack detected: Contract ${contract} tried to change storage of ${contractAddress}`,
                );
            }

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
    public async validateBlockChecksum(blockHeader: BlockHeaderBlockDocument): Promise<boolean> {
        if (!blockHeader.checksumRoot) {
            throw new Error('Block checksum not found');
        }

        const prevBlockHash: string = blockHeader.previousBlockHash;
        const blockHeight: bigint = DataConverter.fromDecimal128(blockHeader.height);
        const blockReceipt: string = blockHeader.receiptRoot;
        const blockStorage: string = blockHeader.storageRoot;
        const blockHash: string = blockHeader.hash;
        const blockMerkelRoot: string = blockHeader.merkleRoot;
        const checksumRoot: string = blockHeader.checksumRoot;
        const proofs: BlockHeaderChecksumProof = blockHeader.checksumProofs;

        if (!blockHeight || !blockReceipt || !blockStorage || !blockHash || !blockMerkelRoot) {
            throw new Error('Block data not found');
        }

        const previousBlockChecksum: string | undefined =
            await this.getPreviousBlockChecksumOfHeight(blockHeight);

        if (!previousBlockChecksum) {
            throw new Error('Previous block checksum not found');
        }

        /** We must validate the block checksum */
        const prevHashProof = this.getProofForIndex(proofs, 0);
        const hasValidPrevHash: boolean = ChecksumMerkle.verify(
            checksumRoot,
            ChecksumMerkle.TREE_TYPE,
            [0, BufferHelper.hexToUint8Array(prevBlockHash)],
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

        const isBlockValid: boolean =
            hasValidPrevHash &&
            hasValidPrevChecksum &&
            hasValidBlockHash &&
            hasValidBlockMerkelRoot &&
            hasValidBlockStorage &&
            hasValidBlockReceipt;
        if (!isBlockValid) {
            this.error(
                `Block was altered. Block height: ${blockHeight} - Block hash: ${blockHash} - Checksum root: ${checksumRoot} (PrevHash: ${hasValidPrevHash}, PrevChecksum: ${hasValidPrevChecksum}, BlockHash: ${hasValidBlockHash}, BlockMerkelRoot: ${hasValidBlockMerkelRoot}, BlockStorage: ${hasValidBlockStorage}, BlockReceipt: ${hasValidBlockReceipt})`,
            );
        }

        return isBlockValid;
    }

    public async getPreviousBlockChecksumOfHeight(height: bigint): Promise<string | undefined> {
        const newBlockHeight: bigint = height - 1n;
        if (newBlockHeight < BigInt(Config.OP_NET.ENABLED_AT_BLOCK)) {
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

        if (!contractDeploymentTransaction.contractAddress) {
            throw new Error('Contract address not found');
        }

        if (Config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
            this.debugBright(
                `Attempting to deploy contract ${contractDeploymentTransaction.contractAddress}`,
            );
        }

        const contractInformation: ContractInformation = ContractInformation.fromTransaction(
            blockHeight,
            contractDeploymentTransaction,
        );

        // We must save the contract information
        await this.setContractAt(contractInformation);

        if (Config.DEBUG_LEVEL >= DebugLevel.INFO) {
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

        this.receiptState.freeze();
    }

    private async getContractInformation(
        contractAddress: BitcoinAddress,
    ): Promise<ContractInformation | undefined> {
        if (this.contractCache.has(contractAddress)) {
            return this.contractCache.get(contractAddress);
        }

        const contractInformation: ContractInformation | undefined =
            await this.vmStorage.getContractAt(contractAddress);

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

    private async saveBlock(block: Block): Promise<void> {
        if (block.height !== this.vmBitcoinBlock.height) {
            throw new Error('Block height mismatch');
        }

        await this.saveBlockHeader(block);
    }

    private async saveBlockHeader(block: Block): Promise<void> {
        await this.vmStorage.saveBlockHeader(block.getBlockHeaderDocument());
    }

    private clear(): void {
        this.blockState = undefined;
        this.receiptState = undefined;

        this.cachedBlockHeader.clear();
        this.verifiedBlockHeights.clear();
        this.contractCache.clear();
    }

    private async getBlockHeader(height: bigint): Promise<BlockHeaderBlockDocument | undefined> {
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

    /** We must save the final state changes to the storage */
    private async saveBlockStateChanges(): Promise<void> {
        if (!this.blockState) {
            throw new Error('Block state not found');
        }

        const stateChanges = this.blockState.getEverythingWithProofs();

        /** Nothing to save. */
        if (!stateChanges) return;

        for (const [address, val] of stateChanges.entries()) {
            for (const [key, value] of val.entries()) {
                if (value[0] === undefined || value[0] === null) {
                    throw new Error(
                        `Value (${value[0]}) not found in state changes. Key ${key.toString()}`,
                    );
                }

                const pointer: StoragePointer = BufferHelper.pointerToUint8Array(key);
                const data: MemoryValue = BufferHelper.valueToUint8Array(value[0]);

                await this.vmStorage.setStorage(
                    address,
                    pointer,
                    data,
                    value[1],
                    this.vmBitcoinBlock.height,
                );
            }
        }
    }

    // don't even question it ????????????????
    private rndPromise(): Promise<void> {
        // ??????????????
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                resolve();
            }, 2);
        });
    }

    /** We must ENSURE that NOTHING get modified EVEN during the execution of the block. This is performance costly but required. */
    private async setStorage(
        address: BitcoinAddress,
        pointer: StoragePointer,
        value: MemoryValue,
    ): Promise<void> {
        /** We must internally change the corresponding storage */
        if (!this.blockState) {
            throw new Error('Block state not found');
        }

        const pointerBigInt: bigint = BufferHelper.uint8ArrayToPointer(pointer);
        const valueBigInt: bigint = BufferHelper.uint8ArrayToValue(value);

        this.blockState.updateValue(address, pointerBigInt, valueBigInt);
    }

    /** We must verify that the storage is correct */
    private async getStorage(
        address: BitcoinAddress,
        pointer: StoragePointer,
        defaultValue: MemoryValue | null = null,
        setIfNotExit: boolean = true,
    ): Promise<MemoryValue | null> {
        /** We must check if we have the value in the current block state */
        if (!this.blockState) {
            throw new Error('Block state not found');
        }

        const pointerBigInt: bigint = BufferHelper.uint8ArrayToPointer(pointer);
        const valueBigInt = this.blockState.getValueWithProofs(address, pointerBigInt);

        let memoryValue: ProvenMemoryValue | null;
        if (!valueBigInt) {
            const valueFromDB = await this.vmStorage.getStorage(
                address,
                pointer,
                defaultValue,
                setIfNotExit,
                this.vmBitcoinBlock.height,
            );

            if (!valueFromDB) {
                return null;
            }

            if (valueFromDB.lastSeenAt === 0n) {
                // Default value.
                //await this.setStorage(address, pointer, valueFromDB.value);

                return valueFromDB.value;
            } else {
                memoryValue = {
                    value: valueFromDB.value,
                    proofs: valueFromDB.proofs,
                    lastSeenAt: valueFromDB.lastSeenAt,
                };
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

        const encodedPointer = this.blockState.encodePointerBuffer(address, pointer);

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

            if (!Config.OP_NET.DISABLE_SCANNED_BLOCK_STORAGE_CHECK && !this.blockState.hasTree()) {
                throw new Error(
                    `Tried to verify the value of a state without a valid tree. Block height: ${blockHeight} - Current height: ${this.vmBitcoinBlock.height} (Have this block been saved already?)`,
                );
            }

            // Same block.
            return Config.OP_NET.DISABLE_SCANNED_BLOCK_STORAGE_CHECK
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

        if (Config.DEBUG_LEVEL >= DebugLevel.TRACE) {
            this.debug(`Validating block ${height} headers...`);
        }

        return this.validateBlockChecksum(blockHeaders);
    }

    private getVMStorage(): VMStorage {
        switch (this.config.INDEXER.STORAGE_TYPE) {
            case IndexerStorageType.MONGODB:
                return new VMMongoStorage(this.config);
            default:
                throw new Error('Invalid VM Storage type.');
        }
    }

    private createRuntimeVM(): Script {
        return this.getScriptFromCodeString(this.runtimeCode);
    }

    private getScriptFromCodeString(sourceCode: string, cachedData?: Buffer): Script {
        const opts: ScriptOptions = {
            cachedData: cachedData,
        };

        return new Script(sourceCode, opts);
    }
}
