import { DebugLevel, Globals, Logger } from '@btc-vision/bsi-common';
import fs from 'fs';
import { RunningScriptInNewContextOptions, Script, ScriptOptions } from 'vm';
import { BitcoinAddress } from '../bitcoin/types/BitcoinAddress.js';
import { ContractInformation } from '../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { DeploymentTransaction } from '../blockchain-indexer/processor/transaction/transactions/DeploymentTransaction.js';
import { InteractionTransaction } from '../blockchain-indexer/processor/transaction/transactions/InteractionTransaction.js';
import { Config } from '../config/Config.js';
import { IBtcIndexerConfig } from '../config/interfaces/IBtcIndexerConfig.js';
import { ADDRESS_BYTE_LENGTH, Selector } from './buffer/types/math.js';
import { EvaluatedContext, VMContext } from './evaluated/EvaluatedContext.js';
import { EvaluatedResult } from './evaluated/EvaluatedResult.js';
import { ContractEvaluator } from './runtime/ContractEvaluator.js';
import { VMMongoStorage } from './storage/databases/VMMongoStorage.js';
import { IndexerStorageType } from './storage/types/IndexerStorageType.js';
import { MemoryValue } from './storage/types/MemoryValue.js';
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
    }

    public async prepareBlock(blockId: bigint): Promise<void> {
        await this.vmBitcoinBlock.prepare(blockId);
    }

    public async revertBlock(): Promise<void> {
        await this.vmBitcoinBlock.revert();
    }

    public async terminateBlock(): Promise<void> {
        await this.vmBitcoinBlock.terminate();
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
        if (Config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
            this.debugBright(`Attempting to execute transaction for contract ${contractAddress}`);
        }

        // TODO: Add a caching layer for this.
        const contractInformation: ContractInformation | null =
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

        return result;
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

    // don't even question it ????????????????
    private rndPromise(): Promise<void> {
        // ??????????????
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                resolve();
            }, 2);
        });
    }

    private async setStorage(
        address: BitcoinAddress,
        pointer: StoragePointer,
        value: MemoryValue,
    ): Promise<void> {
        return this.vmStorage.setStorage(address, pointer, value);
    }

    private async getStorage(
        address: BitcoinAddress,
        pointer: StoragePointer,
        defaultValue: MemoryValue | null = null,
        setIfNotExit: boolean = true,
    ): Promise<MemoryValue | null> {
        return this.vmStorage.getStorage(address, pointer, defaultValue, setIfNotExit);
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
