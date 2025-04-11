import {
    BitcoinNetworkRequest,
    ContractManager,
    EnvironmentVariablesRequest,
    ExitDataResponse,
} from '@btc-vision/op-vm';
import { Blockchain } from '../Blockchain.js';
import { RustContractBinding } from './RustContractBindings.js';

export interface ContractParameters extends Omit<RustContractBinding, 'id'> {
    readonly address: string;

    readonly bytecode: Buffer;
    readonly gasMax: bigint;
    readonly gasUsed: bigint;
    readonly memoryPagesUsed: bigint;
    readonly network: BitcoinNetworkRequest;
    readonly isDebugMode: boolean;

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
            this._id = BigInt(this.contractManager.reserveId().toString());

            Blockchain.registerBinding({
                id: this._id,
                load: this.params.load,
                store: this.params.store,
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

        this.contractManager.instantiate(
            this._id,
            this.params.address,
            this.params.bytecode,
            this.params.gasUsed,
            this.params.gasMax,
            this.params.memoryPagesUsed,
            this.params.network,
            this.params.isDebugMode,
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

    public async execute(calldata: Uint8Array | Buffer): Promise<ExitDataResponse> {
        if (this.enableDebug) console.log('execute', calldata);

        try {
            const result = await this.contractManager.execute(this.id, Buffer.from(calldata));
            return {
                status: Number(result.status),
                data: Buffer.copyBytesFrom(result.data),
                gasUsed: BigInt(result.gasUsed.toString()),
            };
        } catch (e) {
            if (this.enableDebug) console.log('Error in execute', e);

            const error = e as Error;
            throw this.getError(error);
        }
    }

    public setEnvironment(environmentVariables: EnvironmentVariablesRequest): void {
        if (this.enableDebug) console.log('Setting environment', environmentVariables);

        try {
            this.contractManager.setEnvironmentVariables(this.id, environmentVariables);
        } catch (e) {
            if (this.enableDebug) console.log('Error in setEnvironment', e);

            const error = e as Error;
            throw this.getError(error);
        }
    }

    public async onDeploy(calldata: Uint8Array | Buffer): Promise<ExitDataResponse> {
        if (this.enableDebug) console.log('Setting onDeployment', calldata);

        try {
            const result = await this.contractManager.onDeploy(this.id, Buffer.from(calldata));

            return {
                status: Number(result.status),
                data: Buffer.copyBytesFrom(result.data),
                gasUsed: BigInt(result.gasUsed.toString()),
            };
        } catch (e) {
            if (this.enableDebug) console.log('Error in onDeployment', e);

            const error = e as Error;
            throw this.getError(error);
        }
    }

    public getRevertError(): Error {
        const revertInfo = this.contractManager.getExitData(this.id);
        const revertData = Buffer.copyBytesFrom(revertInfo.data);

        try {
            this.dispose();
        } catch {}

        if (revertData.length === 0) {
            return new Error(`Execution reverted`);
        } else {
            const revertDataBytes = Uint8Array.from(revertData);
            return RustContract.decodeRevertData(revertDataBytes);
        }
    }

    public getUsedGas(): bigint {
        try {
            if (this.disposed && this.gasUsed) {
                return this.gasUsed;
            }

            return BigInt(this.contractManager.getUsedGas(this.id).toString());
        } catch (e) {
            const error = e as Error;
            throw this.getError(error);
        }
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
