import { Globals, Logger } from '@btc-vision/bsi-common';
import fs from 'fs';
import { RunningScriptInNewContextOptions, Script, ScriptOptions } from 'vm';
import { BitcoinAddress } from '../bitcoin/types/BitcoinAddress.js';
import { ContractInformation } from '../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { DeploymentTransaction } from '../blockchain-indexer/processor/transaction/transactions/DeploymentTransaction.js';
import { IBtcIndexerConfig } from '../config/interfaces/IBtcIndexerConfig.js';
import { EvaluatedContext, VMContext } from './evaluated/EvaluatedContext.js';
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
    ): Promise<VMContext> {
        const contextOptions: EvaluatedContext = {
            context: {
                logs: [],
                errors: [],
                result: null,

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

    public async deployContract(
        blockHeight: bigint,
        contractDeploymentTransaction: DeploymentTransaction,
    ): Promise<void> {
        if (!contractDeploymentTransaction.contractAddress) {
            throw new Error('Contract address not found');
        }

        this.warn(`Attempting to deploy contract ${contractDeploymentTransaction.contractAddress}`);
        console.log(contractDeploymentTransaction);

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
    }

    // don't even question it ????????????????
    private rndPromise(): Promise<void> {
        // ??????????????
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                resolve();
            }, 0);
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
