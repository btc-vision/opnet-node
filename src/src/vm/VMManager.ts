import { Globals, Logger } from '@btc-vision/motoswapcommon';
import fs from 'fs';
import { RunningScriptInNewContextOptions, Script, ScriptOptions } from 'vm';
import { BitcoinAddress } from '../bitcoin/types/BitcoinAddress.js';
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

    private fakeStorage: Map<string, Map<string, MemoryValue>> = new Map();

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

    // don't even question it ????????????????
    private rndPromise(): Promise<void> {
        // ??????????????
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                resolve();
            }, 0);
        });
    }

    public async loadContractFromBytecode(contractBytecode: Buffer): Promise<VMContext> {
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
            },
        };

        const scriptRunningOptions: RunningScriptInNewContextOptions = {
            timeout: 2000,
            contextCodeGeneration: {
                strings: false,
                wasm: false,
            },
        };

        /*const runtime = new ContractEvaluator(contextOptions.context, console);
        await runtime.init();

        contextOptions.context.contract = runtime;

        return contextOptions.context;*/

        const runtime: Script = this.createRuntimeVM();

        try {
            await runtime.runInNewContext(contextOptions, scriptRunningOptions);
        } catch (error) {
            console.log('Error:', error, contextOptions.context);
        }

        return contextOptions.context;
    }

    private async setStorage(
        address: BitcoinAddress,
        pointer: StoragePointer,
        value: MemoryValue,
    ): Promise<void> {
        return this.vmStorage.setStorage(address, pointer, value);
    }

    private async getStorage(
        address: string,
        pointer: StoragePointer,
        defaultValue: MemoryValue | null = null,
        setIfNotExit: boolean = true,
    ): Promise<MemoryValue | null> {
        const fakeStorage = this.fakeStorage.get(address);

        if (fakeStorage) {
            const value = fakeStorage.get(pointer.toString('hex'));
            if (value) {
                return value;
            }
        }

        return this.vmStorage.getStorage(address, pointer, defaultValue, setIfNotExit);
    }

    public setFakeStorage(address: string, pointer: StoragePointer, value: MemoryValue): void {
        let fakeStorage = this.fakeStorage.get(address);

        if (!fakeStorage) {
            fakeStorage = new Map();
            this.fakeStorage.set(address, fakeStorage);
        }

        fakeStorage.set(pointer.toString('hex'), value);
    }

    public clearFakeStorage(): void {
        this.fakeStorage.clear();
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
