import bytenode from 'bytenode';
import { ok } from 'node:assert';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { RunningScriptInNewContextOptions, Script, ScriptOptions } from 'vm';
import { BitcoinHelper } from '../bitcoin/BitcoinHelper.js';
import { Logger } from '../logger/Logger.js';
import { ABIFactory } from './abi/ABIFactory.js';
import { Contract } from './contracts/Contract.js';
import { EvaluatedContext } from './evaluated/EvaluatedContext.js';
import { EvaluatedContract } from './evaluated/EvaluatedContract.js';
import { MotoSwapFactory } from './test/MotoSwapFactory.js';

export class VMManager extends Logger {
    private readonly MAGIC_NUMBER = Buffer.from([0xde, 0xc0]);
    private readonly ZERO_LENGTH_EXTERNAL_REFERENCE_TABLE = Buffer.alloc(2);

    constructor() {
        super();

        void this.init();
    }

    //private getRndString(): string {
    //    return Buffer.from(crypto.getRandomValues(new Uint32Array(10))).toString('hex');
    //}

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

    private getScriptFromCodeString(sourceCode: string, cachedData?: Buffer): Script {
        const opts: ScriptOptions = {
            cachedData: cachedData,
        };

        return new Script(sourceCode, opts);
    }

    public convertContractToByteCode(sourceClass: Contract, ...args: unknown[]): Buffer {
        const sourceCode = `
            stack.logs = [];
            stack.errors = [];
            
            const console = {
                log: (...args) => {
                    stack.logs.push(args.join(' '));
                },
                error: (...args) => {
                    stack.errors.push(args.join(' '));
                },
            }
            
            const contract = new ${sourceClass.toString()}(${args.map((arg) => JSON.stringify(arg)).join(', ')});
            
            stack.contract = contract;
        `;

        const script = this.getScriptFromCodeString(sourceCode);

        return this.convertScriptToByteCode(script);
    }

    private convertScriptToByteCode(script: Script, override: boolean = false): Buffer {
        let bytecodeBuffer: Buffer = script.createCachedData();
        /*(script.createCachedData && !!script.createCachedData.call) || override
            ? script.createCachedData()
            : (script.cachedData as Buffer);*/

        bytecodeBuffer = brotliCompressSync(bytecodeBuffer);

        return bytecodeBuffer;
    }

    private abiFactory: ABIFactory = new ABIFactory();

    public loadContract(bytecode: Buffer, ABI: Partial<Object>): EvaluatedContract {
        const script = this.restoreOriginalCode(bytecode);
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
            timeout: 400,
            contextCodeGeneration: {
                strings: false,
                wasm: false,
            },
            microtaskMode: 'afterEvaluate',
        };

        const evaluatedContract = new EvaluatedContract(contextOptions, ABI, () => {
            return this.convertScriptToByteCode(script, true);
        });

        const contract = script.runInNewContext(contextOptions, scriptRunningOptions);
        evaluatedContract.setContract(contract);

        return evaluatedContract;
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

    private async testSomething(contract: Contract): Promise<void> {
        const rndContractOwner = BitcoinHelper.generateWallet();

        const ABI = this.abiFactory.generateABIForContract(contract);
        const bytecodeBuffer = this.convertContractToByteCode(contract, rndContractOwner, ABI);
        const deployedContract = this.loadContract(bytecodeBuffer, ABI);

        console.log('bytecode BEFORE ->', deployedContract.bytecode);

        deployedContract.insertBackDoorTokens(rndContractOwner, 1000000000000000000n);

        //const result = deployedContract.evaluate(Buffer.alloc(0));
        console.log('bytecode AFTER ->', deployedContract.bytecode);
    }

    public async init(): Promise<void> {
        await this.testSomething(MotoSwapFactory);

        this.log(`VMManager initialized.`);

        setInterval(() => {}, 100000);
    }
}

new VMManager();
