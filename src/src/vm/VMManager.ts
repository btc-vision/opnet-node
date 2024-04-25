import { DebugLevel, Globals, Logger } from '@btc-vision/bsi-common';
import fs from 'fs';
import { RunningScriptInNewContextOptions, Script, ScriptOptions } from 'vm';
import { BitcoinAddress } from '../bitcoin/types/BitcoinAddress.js';
import { Block } from '../blockchain-indexer/processor/block/Block.js';
import {
    BlockHeaderBlockDocument,
    BlockHeaderChecksumProof,
} from '../blockchain-indexer/processor/block/interfaces/IBlockHeaderBlockDocument.js';
import { ZERO_HASH } from '../blockchain-indexer/processor/block/interfaces/ZeroValue.js';
import { ChecksumMerkle } from '../blockchain-indexer/processor/block/merkle/ChecksumMerkle.js';
import { StateMerkleTree } from '../blockchain-indexer/processor/block/merkle/StateMerkleTree.js';
import { ContractInformation } from '../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { DeploymentTransaction } from '../blockchain-indexer/processor/transaction/transactions/DeploymentTransaction.js';
import { InteractionTransaction } from '../blockchain-indexer/processor/transaction/transactions/InteractionTransaction.js';
import { Config } from '../config/Config.js';
import { IBtcIndexerConfig } from '../config/interfaces/IBtcIndexerConfig.js';
import { BlockRootStates } from '../db/interfaces/BlockRootStates.js';
import { BufferHelper } from '../utils/BufferHelper.js';
import { ADDRESS_BYTE_LENGTH, Selector } from './buffer/types/math.js';
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

    private cachedBlockStates: Map<bigint, BlockRootStates> = new Map();

    constructor(private readonly config: IBtcIndexerConfig) {
        super();

        this.vmStorage = this.getVMStorage();
        this.vmBitcoinBlock = new VMBitcoinBlock(this.vmStorage);
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

        if (!this.blockState) {
            throw new Error('Block state not found');
        }

        const contractAddress: BitcoinAddress = interactionTransaction.contractAddress;
        if (Config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
            this.debugBright(`Attempting to execute transaction for contract ${contractAddress}`);
        }

        // TODO: Add a caching layer for this.
        const contractInformation: ContractInformation | undefined =
            await this.vmStorage.getContractAt(contractAddress);

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

        if (Config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
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

        this.blockState.generateTree();

        return result;
    }

    public async validateBlockChecksum(blockHeader: BlockHeaderBlockDocument): Promise<boolean> {
        if (!blockHeader.checksumRoot) {
            throw new Error('Block checksum not found');
        }

        const prevBlockHash: string = blockHeader.previousBlockHash;
        const blockHeight: bigint = BufferHelper.fromDecimal128(blockHeader.height);
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

        // We must verify that there is no contract already deployed at this address
        const hasContractDeployedAtAddress: boolean = await this.vmStorage.hasContractAt(
            contractInformation.contractAddress,
        );

        if (!hasContractDeployedAtAddress) {
            await this.vmStorage.setContractAt(contractInformation);
        } else {
            throw new Error('Contract already deployed at address');
        }

        if (Config.DEBUG_LEVEL >= DebugLevel.INFO) {
            this.info(`Contract ${contractInformation.contractAddress} deployed.`);
        }
    }

    public async updateEvaluatedStates(): Promise<EvaluatedStates> {
        if (!this.blockState) {
            throw new Error('Block state not found');
        }

        this.blockState.freeze();

        await this.saveBlockStateChanges();

        const states: EvaluatedStates = {
            storage: this.blockState,
        };

        this.blockState = undefined;
        return states;
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
        this.cachedBlockStates.clear();
    }

    private async getBlockRootStates(height: bigint): Promise<BlockRootStates | undefined> {
        if (this.cachedBlockStates.has(height)) {
            return this.cachedBlockStates.get(height);
        }

        const blockRootStates: BlockRootStates | undefined =
            await this.vmStorage.getBlockRootStates(height);

        if (blockRootStates) {
            this.cachedBlockStates.set(height, blockRootStates);
        }

        return blockRootStates;
    }

    private async getBlockHeader(height: bigint): Promise<BlockHeaderBlockDocument | undefined> {
        return await this.vmStorage.getBlockHeader(height);
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
                if (!value[0]) {
                    throw new Error('Value not found. Cannot save changes.');
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

            if (!this.blockState.hasTree()) {
                throw new Error(
                    `Tried to verify the value of a state without a valid tree. Block height: ${blockHeight} - Current height: ${this.vmBitcoinBlock.height} (Have this block been saved already?)`,
                );
            }

            // Same block.
            return StateMerkleTree.verify(
                this.blockState.root,
                StateMerkleTree.TREE_TYPE,
                [encodedPointer, value],
                proofs,
            );
        }

        /** We must get the block root states */
        const blockRootStates: BlockRootStates | undefined =
            await this.getBlockRootStates(blockHeight);

        if (!blockRootStates) {
            throw new Error(
                `Block root states not found for block ${blockHeight}. DATA CORRUPTED.`,
            );
        }

        // We must verify the proofs from the block root states.
        return StateMerkleTree.verify(
            blockRootStates.storageRoot,
            StateMerkleTree.TREE_TYPE,
            [encodedPointer, value],
            proofs,
        );
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
