import { VMStorage } from '../vm/storage/VMStorage.js';
import { VMManager } from '../vm/VMManager.js';
import { Config } from '../config/Config.js';
import { Logger } from '@btc-vision/bsi-common';
import { OPNetConsensus } from '../poa/configurations/OPNetConsensus.js';
import { BitcoinRPC } from '@btc-vision/bsi-bitcoin-rpc';
import {
    CallRequestData,
    CallRequestResponse,
} from '../threading/interfaces/thread-messages/messages/api/CallRequest.js';
import { DebugLevel } from '@btc-vision/logger';
import { BTC_FAKE_ADDRESS } from '../blockchain-indexer/processor/block/types/ZeroValue.js';
import { BlockchainStorageMap, EvaluatedEvents } from '../vm/evaluated/EvaluatedResult.js';
import {
    ContractInformation,
    ContractInformationAsString,
} from '../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { contractManager } from '../vm/isolated/RustContract.js';

class RPCManager extends Logger {
    public readonly logColor: string = '#00ff66';

    private readonly bitcoinRPC: BitcoinRPC = new BitcoinRPC();
    private readonly vmManagers: VMManager[] = [];
    private currentVMManagerIndex: number = 0;

    private readonly CONCURRENT_VMS: number = 1;

    private currentBlockHeight: bigint = 0n;

    constructor() {
        super();

        void this.init();
    }

    protected async onMessage(message: string): Promise<void> {
        try {
            const data = JSON.parse(message) as { taskId: string; data: object; type: string };

            if (data.type === 'call') {
                let result: CallRequestResponse | undefined = await this.onCallRequest(
                    data.data as CallRequestData,
                );
                if (result && !('error' in result)) {
                    result = Object.assign(result, {
                        result: result.result ? Buffer.from(result.result).toString('hex') : '',
                        changedStorage: result.changedStorage
                            ? this.convertMapToArray(result.changedStorage)
                            : [],
                        events: result.events ? this.convertEventsToArray(result.events) : [],
                        deployedContracts: result.deployedContracts
                            ? this.convertDeployedContractsToArray(result.deployedContracts)
                            : [],
                    });
                }

                this.send({
                    taskId: data.taskId,
                    data: result,
                });
            }
        } catch (e) {
            this.error(`Failed to process message. ${e}`);
        }
    }

    protected listenToEvents(): void {
        process.on('message', this.onMessage.bind(this));
    }

    protected async init(): Promise<void> {
        this.listenToEvents();

        await this.bitcoinRPC.init(Config.BLOCKCHAIN);
        await this.setBlockHeight();
        await this.createVMManagers();
    }

    protected async getNextVMManager(tries: number = 0): Promise<VMManager> {
        if (tries > 10) {
            throw new Error('Failed to get a VMManager');
        }

        return new Promise<VMManager>((resolve) => {
            const startNumber = this.currentVMManagerIndex;
            let vmManager: VMManager | undefined;

            do {
                vmManager = this.vmManagers[this.currentVMManagerIndex];
                this.currentVMManagerIndex = (this.currentVMManagerIndex + 1) % this.CONCURRENT_VMS;

                if (!vmManager.busy() && vmManager.initiated) {
                    break;
                }
            } while (this.currentVMManagerIndex !== startNumber);

            if (!vmManager) {
                setTimeout(async () => {
                    this.warn(
                        `High load detected. Try to increase your RPC thread limit or do fewer requests.`,
                    );

                    const vmManager = await this.getNextVMManager(tries + 1);
                    resolve(vmManager);
                }, 100);
            }

            resolve(vmManager);
        });
    }

    private convertDeployedContractsToArray(
        contracts: ContractInformation[],
    ): ContractInformationAsString[] {
        const array: ContractInformationAsString[] = [];

        for (const contract of contracts) {
            const contractAsString: ContractInformationAsString = {
                blockHeight: contract.blockHeight.toString(),
                contractAddress: contract.contractAddress.toString(),
                virtualAddress: contract.virtualAddress.toString(),
                p2trAddress: contract.p2trAddress ? contract.p2trAddress.toString() : null,
                bytecode: contract.bytecode.toString('hex'),
                wasCompressed: contract.wasCompressed,
                deployedTransactionId: contract.deployedTransactionId,
                deployedTransactionHash: contract.deployedTransactionHash,
                deployerPubKey: contract.deployerPubKey.toString('hex'),
                contractSeed: contract.contractSeed.toString('hex'),
                contractSaltHash: contract.contractSaltHash.toString('hex'),
                deployerAddress: contract.deployerAddress.toString(),
            };

            array.push(contractAsString);
        }

        return array;
    }

    private convertEventsToArray(events: EvaluatedEvents): [string, [string, string, string][]][] {
        const array: [string, [string, string, string][]][] = [];

        for (const [key, value] of events) {
            const innerArray: [string, string, string][] = [];
            for (const event of value) {
                innerArray.push([
                    event.eventType,
                    event.eventDataSelector.toString(),
                    Buffer.from(event.eventData).toString('hex'),
                ]);
            }

            array.push([key.toString(), innerArray]);
        }

        return array;
    }

    private convertMapToArray(map: BlockchainStorageMap): [string, [string, string][]][] {
        const array: [string, [string, string][]][] = [];

        for (const [key, value] of map) {
            const innerArray: [string, string][] = [];
            for (const [innerKey, innerValue] of value) {
                innerArray.push([innerKey.toString(), innerValue.toString()]);
            }

            array.push([key, innerArray]);
        }

        return array;
    }

    private send(data: object): void {
        if (!process.send) throw new Error('process.send is not a function');

        process.send(data);
    }

    private async setBlockHeight(): Promise<void> {
        try {
            const blockHeight = await this.bitcoinRPC.getBlockHeight();
            if (!blockHeight) {
                throw new Error('Failed to get block height');
            }

            this.currentBlockHeight = BigInt(blockHeight.blockHeight + 1);
            OPNetConsensus.setBlockHeight(this.currentBlockHeight);
        } catch (e) {
            this.error(`Failed to get block height. ${e}`);
        }

        setTimeout(() => {
            void this.setBlockHeight();
        }, 5000);
    }

    private async createVMManagers(): Promise<void> {
        let vmStorage: VMStorage | undefined = undefined;
        for (let i = 0; i < this.CONCURRENT_VMS; i++) {
            const vmManager: VMManager = new VMManager(Config, true, vmStorage);
            await vmManager.init();

            if (!vmStorage) {
                vmStorage = vmManager.getVMStorage();
            }

            this.vmManagers.push(vmManager);
        }

        setInterval(async () => {
            for (let i = 0; i < this.vmManagers.length; i++) {
                const vmManager = this.vmManagers[i];
                await vmManager.clear();
            }

            contractManager.destroyAll();
        }, 30000);
    }

    private async onCallRequest(data: CallRequestData): Promise<CallRequestResponse | undefined> {
        if (Config.DEBUG_LEVEL >= DebugLevel.TRACE) {
            this.info(
                `Call request received. {To: ${data.to.toString()}, Calldata: ${data.calldata}}`,
            );
        }

        const vmManager = await this.getNextVMManager();

        let result: CallRequestResponse | undefined;
        try {
            result = await vmManager.execute(
                data.to,
                data.from || BTC_FAKE_ADDRESS,
                data.calldata,
                data.blockNumber,
            );
        } catch (e) {
            const error = e as Error;

            result = {
                error: error.message || 'Unknown error',
            };
        }

        return result;
    }
}

new RPCManager();
