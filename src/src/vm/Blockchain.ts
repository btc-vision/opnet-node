import { RustContractBinding } from './isolated/RustContractBindings.js';
import { ContractManager } from '@btc-vision/op-vm';
import { VMTCPServer } from './tcp/VMTCPServer.js';

class BlockchainBase {
    private readonly bindings: Map<bigint, RustContractBinding> = new Map<
        bigint,
        RustContractBinding
    >();

    private readonly enableDebug: boolean = false;

    private readonly tcpServer: VMTCPServer;

    constructor() {
        this.tcpServer = new VMTCPServer(this.bindings, this.enableDebug);
    }

    private _contractManager?: ContractManager;

    public get contractManager(): ContractManager {
        if (!this._contractManager) {
            throw new Error('Contract manager not initialized');
        }

        return this._contractManager;
    }

    public async createManager(): Promise<void> {
        const port = await this.tcpServer.start();

        this._contractManager = new ContractManager(
            1, // max idling runtime
            port,
            1,
        );
    }

    public purgeCached(): void {
        if (this._contractManager) this.contractManager.destroyCache();
    }

    public removeBinding(id: bigint): void {
        this.bindings.delete(id);
    }

    public registerBinding(binding: RustContractBinding): void {
        this.bindings.set(binding.id, binding);
    }

    public purge(): void {
        if (this._contractManager) this.contractManager.destroyAll();

        this.bindings.clear();
    }

    // For future use?
    /*public cleanUp(): void {
        this.contractManager.destroyAll();
        this.contractManager.destroy();

        delete this._contractManager;
    }*/
}

export const Blockchain = new BlockchainBase();
