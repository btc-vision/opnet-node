import { BitcoinNetworkRequest, ContractManager, ExitDataResponse, init } from '@btc-vision/op-vm';
import { BinaryWriter } from '@btc-vision/transaction';
import { RustContractBinding } from './RustContractBindings.js';
import { Blockchain, ENABLE_BUFFER_AS_STRING } from '../Blockchain.js';

init();

export interface ExitDataResponseRaw {
    status: number;
    data: Buffer;
    gasUsed: bigint;
    proofs: Array<{ proof: Buffer; vk: Buffer }>;
}

export interface EnvironmentVariablesRequestRaw {
    blockHash: Uint8Array;
    blockNumber: bigint;
    blockMedianTime: bigint;
    txId: Uint8Array;
    txHash: Uint8Array;
    contractAddress: Uint8Array;
    contractDeployer: Uint8Array;
    caller: Uint8Array;
    origin: Uint8Array;
}

export interface ContractParameters extends Omit<RustContractBinding, 'id'> {
    readonly address: string;

    readonly bytecode: Buffer;
    readonly gasMax: bigint;
    readonly gasUsed: bigint;
    readonly memoryPagesUsed: bigint;
    readonly network: BitcoinNetworkRequest;
    readonly isDebugMode: boolean;
    readonly returnProofs: boolean;

    readonly contractManager: ContractManager;
}

export class RustContract {
    private readonly enableDebug: boolean = false;
    private readonly enableDisposeLog: boolean = false;

    private gasUsed: bigint = 0n;

    private readonly contractManager: ContractManager;

    constructor(params: ContractParameters) {
        this._params = params;
        this.contractManager = params.contractManager;
    }

    private _id?: bigint;

    public get id() {
        if (this.disposed) {
            throw new Error('Contract is disposed.');
        }

        if (this._id == null) {
            this._id = this.contractManager.reserveId();

            Blockchain.registerBinding({
                id: this._id,
                load: this.params.load,
                store: this.params.store,
                tLoad: this.params.tLoad,
                tStore: this.params.tStore,
                call: this.params.call,
                deployContractAtAddress: this.params.deployContractAtAddress,
                log: this.params.log,
                emit: this.params.emit,
                inputs: this.params.inputs,
                outputs: this.params.outputs,
                accountType: this.params.accountType,
                blockHash: this.params.blockHash,
            });

            this.instantiate();
        }

        return this._id;
    }

    private _instantiated: boolean = false;

    public get instantiated(): boolean {
        return this._instantiated;
    }

    private _disposed: boolean = false;

    public get disposed(): boolean {
        return this._disposed;
    }

    private _params?: ContractParameters | null;

    private get params(): ContractParameters {
        if (!this._params) {
            throw new Error('Contract is disposed - cannot access parameters.');
        }

        return this._params;
    }

    public static getErrorAsBuffer(error: Error | string | undefined): Uint8Array {
        const errorWriter = new BinaryWriter();
        errorWriter.writeSelector(0x63739d5c);
        errorWriter.writeStringWithLength(
            typeof error === 'string' ? error : error?.message || 'Unknown error',
        );

        return errorWriter.getBuffer();
    }

    public static decodeRevertData(revertDataBytes: Uint8Array): Error {
        if (RustContract.startsWithErrorSelector(revertDataBytes)) {
            const decoder = new TextDecoder();
            const revertMessage = decoder.decode(revertDataBytes.slice(6));

            return new Error(revertMessage);
        } else {
            return new Error(`Execution reverted: 0x${this.bytesToHexString(revertDataBytes)}`);
        }
    }

    private static startsWithErrorSelector(revertDataBytes: Uint8Array) {
        const errorSelectorBytes = Uint8Array.from([0x63, 0x73, 0x9d, 0x5c]);
        return (
            revertDataBytes.length >= 4 &&
            this.areBytesEqual(revertDataBytes.slice(0, 4), errorSelectorBytes)
        );
    }

    private static areBytesEqual(a: Uint8Array, b: Uint8Array) {
        if (a.length !== b.length) return false;

        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
                return false;
            }
        }

        return true;
    }

    private static bytesToHexString(byteArray: Uint8Array): string {
        return Array.from(byteArray, function (byte) {
            return ('0' + (byte & 0xff).toString(16)).slice(-2);
        }).join('');
    }

    public instantiate(): void {
        if (this._id == null) throw new Error('Contract is not instantiated');
        if (this._instantiated) return;

        const bytes = Buffer.copyBytesFrom(this.params.bytecode);

        this.contractManager.instantiate(
            BigInt(this._id.toString()),
            String(this.params.address),
            ENABLE_BUFFER_AS_STRING ? bytes.toString('hex') : bytes,
            BigInt(this.params.gasUsed.toString()),
            BigInt(this.params.gasMax.toString()),
            BigInt(this.params.memoryPagesUsed.toString()),
            Number(this.params.network),
            Boolean(this.params.isDebugMode),
            this.params.returnProofs,
        );

        this._instantiated = true;
    }

    public dispose(): void {
        if (!this.instantiated) return;

        if (this._id == null) {
            throw new Error('Contract is not instantiated');
        }

        if (this.enableDebug || this.enableDisposeLog) console.log('Disposing contract', this._id);

        let deadlock: unknown;
        try {
            this.gasUsed = this.getUsedGas();
        } catch (e) {
            deadlock = e;
        }

        delete this._params;

        if (this.disposed) return;
        this._disposed = true;

        Blockchain.removeBinding(this._id);
        this.contractManager.destroyContract(this._id);

        if (deadlock) {
            const strErr = (deadlock as Error).message;

            if (strErr.includes('mutex')) {
                throw new Error('OP_NET: REENTRANCY DETECTED');
            }
        }
    }

    public async execute(calldata: Uint8Array | Buffer): Promise<Readonly<ExitDataResponseRaw>> {
        if (this.enableDebug) console.log('execute', calldata);

        try {
            const calldataAsBuf: Buffer = Buffer.copyBytesFrom(calldata);
            const call = ENABLE_BUFFER_AS_STRING ? calldataAsBuf.toString('hex') : calldataAsBuf;
            const result = await this.contractManager.execute(this.id, call);

            return this.toReadonlyObject(result);
        } catch (e) {
            if (this.enableDebug) console.log('Error in execute', e);

            const error = e as Error;
            throw this.getError(error);
        }
    }

    public setEnvironment(environmentVariables: EnvironmentVariablesRequestRaw): void {
        if (this.enableDebug) console.log('Setting environment', environmentVariables);

        try {
            const params = Object.preventExtensions(
                Object.freeze(
                    Object.seal({
                        blockNumber: BigInt(environmentVariables.blockNumber.toString()),
                        blockMedianTime: BigInt(environmentVariables.blockMedianTime.toString()),
                        blockHash: (ENABLE_BUFFER_AS_STRING
                            ? Buffer.copyBytesFrom(environmentVariables.blockHash).toString('hex')
                            : Buffer.copyBytesFrom(
                                  environmentVariables.blockHash,
                              )) as unknown as Buffer,
                        txId: (ENABLE_BUFFER_AS_STRING
                            ? Buffer.copyBytesFrom(environmentVariables.txId).toString('hex')
                            : Buffer.copyBytesFrom(environmentVariables.txId)) as unknown as Buffer,
                        txHash: (ENABLE_BUFFER_AS_STRING
                            ? Buffer.copyBytesFrom(environmentVariables.txHash).toString('hex')
                            : Buffer.copyBytesFrom(
                                  environmentVariables.txHash,
                              )) as unknown as Buffer,
                        contractAddress: (ENABLE_BUFFER_AS_STRING
                            ? Buffer.copyBytesFrom(environmentVariables.contractAddress).toString(
                                  'hex',
                              )
                            : Buffer.copyBytesFrom(
                                  environmentVariables.contractAddress,
                              )) as unknown as Buffer,
                        contractDeployer: (ENABLE_BUFFER_AS_STRING
                            ? Buffer.copyBytesFrom(environmentVariables.contractDeployer).toString(
                                  'hex',
                              )
                            : Buffer.copyBytesFrom(
                                  environmentVariables.contractDeployer,
                              )) as unknown as Buffer,
                        caller: (ENABLE_BUFFER_AS_STRING
                            ? Buffer.copyBytesFrom(environmentVariables.caller).toString('hex')
                            : Buffer.copyBytesFrom(
                                  environmentVariables.caller,
                              )) as unknown as Buffer,
                        origin: (ENABLE_BUFFER_AS_STRING
                            ? Buffer.copyBytesFrom(environmentVariables.origin).toString('hex')
                            : Buffer.copyBytesFrom(
                                  environmentVariables.origin,
                              )) as unknown as Buffer,
                    }),
                ),
            );

            this.contractManager.setEnvironmentVariables(this.id, params);
        } catch (e) {
            if (this.enableDebug) console.log('Error in setEnvironment', e);

            const error = e as Error;
            throw this.getError(error);
        }
    }

    public async onDeploy(calldata: Uint8Array | Buffer): Promise<Readonly<ExitDataResponseRaw>> {
        if (this.enableDebug) console.log('Setting onDeployment', calldata);

        try {
            const calldataAsBuf: Buffer = Buffer.copyBytesFrom(calldata);
            const call = ENABLE_BUFFER_AS_STRING ? calldataAsBuf.toString('hex') : calldataAsBuf;
            const result = await this.contractManager.onDeploy(this.id, call);

            return this.toReadonlyObject(result);
        } catch (e) {
            if (this.enableDebug) console.log('Error in onDeployment', e);

            const error = e as Error;
            throw this.getError(error);
        }
    }

    public getRevertError(): Error {
        const revertInfo = this.contractManager.getExitData(this.id);
        const revertData = this.copyBuffer(revertInfo.data);

        try {
            this.dispose();
        } catch {}

        if (revertData.length === 0) {
            return new Error(`Execution reverted`);
        } else {
            return RustContract.decodeRevertData(revertData);
        }
    }

    public getUsedGas(): bigint {
        try {
            if (this.disposed && this.gasUsed) {
                return this.gasUsed;
            }

            return this.contractManager.getUsedGas(this.id);
        } catch (e) {
            const error = e as Error;
            throw this.getError(error);
        }
    }

    private copyBuffer(input: Buffer | string): Buffer {
        return ENABLE_BUFFER_AS_STRING
            ? Buffer.from(input as string, 'hex')
            : Buffer.copyBytesFrom(input as Buffer);
    }

    private toReadonlyObject(result: ExitDataResponse): Readonly<ExitDataResponseRaw> {
        return Object.preventExtensions(
            Object.freeze(
                Object.seal({
                    status: Number(result.status),
                    data: this.copyBuffer(result.data),
                    gasUsed: BigInt(result.gasUsed.toString()),
                    proofs: result.proofs.map((proof) => {
                        return {
                            proof: this.copyBuffer(proof.proof),
                            vk: this.copyBuffer(proof.vk),
                        };
                    }),
                }),
            ),
        );
    }

    private getError(err: Error): Error {
        if (this.enableDebug) console.log('Getting error', err);

        const msg = err.message;
        if (msg.includes('Execution reverted') && !msg.includes('Execution reverted:')) {
            return this.getRevertError();
        } else {
            return err;
        }
    }
}
