import bytenode from 'bytenode';
import fs from 'fs';
import { ok } from 'node:assert';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { RunningScriptInNewContextOptions, Script, ScriptOptions } from 'vm';
import { Logger } from '../logger/Logger.js';
import { ABIFactory } from './abi/ABIFactory.js';
import { EvaluatedContext } from './evaluated/EvaluatedContext.js';

export class VMManager extends Logger {
    private readonly MAGIC_NUMBER: Buffer = Buffer.from([0xde, 0xc0]);
    private readonly ZERO_LENGTH_EXTERNAL_REFERENCE_TABLE = Buffer.alloc(2);

    private readonly runtimeCode: string = fs.readFileSync(`../runtime`).toString();
    private abiFactory: ABIFactory = new ABIFactory();

    constructor() {
        super();

        void this.init();
    }

    public fixBytecode(bytecodeBuffer: Buffer): void {
        if (!Buffer.isBuffer(bytecodeBuffer)) {
            throw new Error('bytecodeBuffer must be a buffer object.');
        }

        const dummyBytecode = bytenode.compileCode('"ಠ_ಠ"', false);
        const version = parseFloat(process.version.slice(1, 5));

        if (process.version.startsWith('v8.8') || process.version.startsWith('v8.9')) {
            // Node is v8.8.x or v8.9.x
            dummyBytecode.subarray(16, 20).copy(bytecodeBuffer, 16);
            dummyBytecode.subarray(20, 24).copy(bytecodeBuffer, 20);
        } else if (version >= 12 && version <= 21) {
            dummyBytecode.subarray(12, 16).copy(bytecodeBuffer, 12);
        } else {
            dummyBytecode.subarray(12, 16).copy(bytecodeBuffer, 12);
            dummyBytecode.subarray(16, 20).copy(bytecodeBuffer, 16);
        }
    }

    public async loadContractFromBytecode(contractBytecode: Buffer): Promise<unknown> {
        const contextOptions: EvaluatedContext = {
            stack: {
                logs: null,
                errors: null,
                contract: null,
                result: null,
            },

            process: null,
        };

        const scriptRunningOptions: RunningScriptInNewContextOptions = {
            timeout: 2000,
            contextCodeGeneration: {
                strings: false,
                wasm: false,
            },
            microtaskMode: 'afterEvaluate',
        };

        const runtime: Script = this.createRuntimeVM();
        const contract = runtime.runInNewContext(contextOptions, scriptRunningOptions);

        return contract;
    }

    public async init(): Promise<void> {
        this.log(`VMManager initialized.`);

        await this.test();
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

    private convertScriptToByteCode(script: Script): Buffer {
        let bytecodeBuffer: Buffer = script.createCachedData();
        bytecodeBuffer = brotliCompressSync(bytecodeBuffer);

        return bytecodeBuffer;
    }

    private isBufferV8Bytecode(buffer: Buffer): boolean {
        return (
            Buffer.isBuffer(buffer) &&
            !buffer.subarray(0, 2).equals(this.ZERO_LENGTH_EXTERNAL_REFERENCE_TABLE) &&
            buffer.subarray(2, 4).equals(this.MAGIC_NUMBER)
        );
    }

    private restoreOriginalCode(cachedData: Buffer): Script {
        if (!this.isBufferV8Bytecode(cachedData)) {
            // Try to decompress as Brotli
            cachedData = brotliDecompressSync(cachedData);

            ok(this.isBufferV8Bytecode(cachedData), 'Invalid bytecode buffer');
        }

        this.fixBytecode(cachedData);

        const length = this.readSourceHash(cachedData);

        let dummyCode = '';
        if (length > 1) {
            dummyCode = '"' + '\u200b'.repeat(length - 2) + '"'; // "\u200b" Zero width space
        }

        const script = this.getScriptFromCodeString(dummyCode, cachedData);
        if (script.cachedDataRejected) {
            throw new Error('Invalid or incompatible cached data (cachedDataRejected)');
        }

        return script;
    }

    private async test(): Promise<void> {
        const idk = await this.loadContractFromBytecode();
    }

    private readSourceHash(bytecodeBuffer: Buffer): number {
        if (!Buffer.isBuffer(bytecodeBuffer)) {
            throw new Error('bytecodeBuffer must be a buffer object.');
        }

        if (process.version.startsWith('v8.8') || process.version.startsWith('v8.9')) {
            // Node is v8.8.x or v8.9.x
            // eslint-disable-next-line no-return-assign
            return bytecodeBuffer
                .subarray(12, 16)
                .reduce((sum, number, power) => (sum += number * Math.pow(256, power)), 0);
        } else {
            // eslint-disable-next-line no-return-assign
            return bytecodeBuffer
                .subarray(8, 12)
                .reduce((sum, number, power) => (sum += number * Math.pow(256, power)), 0);
        }
    }
}

new VMManager();
