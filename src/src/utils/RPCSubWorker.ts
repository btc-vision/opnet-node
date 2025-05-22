import { VMStorage } from '../vm/storage/VMStorage.js';
import { VMManager } from '../vm/VMManager.js';
import { Config } from '../config/Config.js';
import { Logger } from '@btc-vision/bsi-common';
import { BitcoinRPC } from '@btc-vision/bitcoin-rpc';
import {
    CallRequestData,
    CallRequestResponse,
} from '../threading/interfaces/thread-messages/messages/api/CallRequest.js';
import { DebugLevel } from '@btc-vision/logger';
import { BTC_FAKE_ADDRESS } from '../blockchain-indexer/processor/block/types/ZeroValue.js';
import {
    BlockchainStorageMap,
    EvaluatedEvents,
    EvaluatedResult,
} from '../vm/evaluated/EvaluatedResult.js';
import {
    ContractInformation,
    ContractInformationAsString,
} from '../blockchain-indexer/processor/transaction/contract/ContractInformation.js';
import { Blockchain } from '../vm/Blockchain.js';
import { VMMongoStorage } from '../vm/storage/databases/VMMongoStorage.js';
import { OPNetConsensus } from '../poa/configurations/OPNetConsensus.js';
import { Address, AddressMap, BufferHelper, PointerStorage } from '@btc-vision/transaction';
import {
    CallRequestError,
    LoadedStorageList,
} from '../api/json-rpc/types/interfaces/results/states/CallResult.js';
import {
    ParsedSimulatedTransaction,
    SimulatedTransaction,
} from '../api/json-rpc/types/interfaces/params/states/CallParams.js';
import { TransactionOutputFlags } from '../poa/configurations/types/IOPNetConsensus.js';

class RPCManager extends Logger {
    public readonly logColor: string = '#00ff66';

    private readonly bitcoinRPC: BitcoinRPC = new BitcoinRPC();
    private readonly vmManagers: VMManager[] = [];
    private currentVMManagerIndex: number = 0;

    private readonly CONCURRENT_VMS: number = Config.RPC.VM_CONCURRENCY || 1;

    private currentBlockHeight: bigint = 0n;

    private readonly vmStorage: VMStorage = new VMMongoStorage(Config);

    public constructor() {
        super();
    }

    public async init(): Promise<void> {
        this.listenToEvents();

        await this.bitcoinRPC.init(Config.BLOCKCHAIN);
        await this.vmStorage.init();

        await this.setBlockHeight();
        await this.createVMManagers();
    }

    protected async onMessage(message: string): Promise<void> {
        try {
            const data = JSON.parse(message) as { taskId: string; data: object; type: string };

            if (data.type === 'call') {
                let result: EvaluatedResult | CallRequestError | undefined =
                    await this.onCallRequest(data.data as CallRequestData);

                if (result && !('error' in result)) {
                    result = Object.assign(result, {
                        result: result.result ? Buffer.from(result.result).toString('hex') : '',
                        revert: result.revert ? Buffer.from(result.revert).toString('hex') : '',
                        changedStorage: result.changedStorage
                            ? this.convertMapToArray(result.changedStorage)
                            : [],
                        loadedStorage: result.loadedStorage
                            ? this.convertLoadedStorageToArray(result.loadedStorage)
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

    protected async getNextVMManager(tries: number = 0): Promise<VMManager> {
        if (tries > 10) {
            throw new Error('Failed to get a VMManager');
        }

        return new Promise<VMManager>(async (resolve) => {
            const startNumber = this.currentVMManagerIndex;
            let vmManager: VMManager | undefined;

            do {
                vmManager = this.vmManagers[this.currentVMManagerIndex];
                this.currentVMManagerIndex = (this.currentVMManagerIndex + 1) % this.CONCURRENT_VMS;

                if (!vmManager.busy() && vmManager.initiated) {
                    break;
                }
            } while (this.currentVMManagerIndex !== startNumber);

            if (vmManager) {
                resolve(vmManager);
                return;
            }

            this.warn(
                `High load detected. Try to increase your RPC thread limit or do fewer requests.`,
            );

            await this.sleep(100);

            resolve(await this.getNextVMManager(tries + 1));
        });
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private convertDeployedContractsToArray(
        contracts: ContractInformation[],
    ): ContractInformationAsString[] {
        const array: ContractInformationAsString[] = [];

        for (const contract of contracts) {
            const contractAsString: ContractInformationAsString = {
                blockHeight: contract.blockHeight.toString(),
                contractAddress: contract.contractAddress.toString(),
                contractTweakedPublicKey: contract.contractTweakedPublicKey.toString(),
                contractHybridPublicKey: contract.contractHybridPublicKey.toString(),
                bytecode: contract.bytecode.toString('hex'),
                wasCompressed: contract.wasCompressed,
                deployedTransactionId: contract.deployedTransactionId.toString('hex'),
                deployedTransactionHash: contract.deployedTransactionHash.toString('hex'),
                deployerPubKey: contract.deployerPubKey.toString('hex'),
                contractSeed: contract.contractSeed.toString('hex'),
                contractSaltHash: contract.contractSaltHash.toString('hex'),
                deployerAddress: contract.deployerAddress.toHex(),
            };

            array.push(contractAsString);
        }

        return array;
    }

    private convertEventsToArray(events: EvaluatedEvents): [string, [string, string][]][] {
        const array: [string, [string, string][]][] = [];

        for (const [key, value] of events) {
            const innerArray: [string, string][] = [];
            for (const event of value) {
                innerArray.push([event.type, Buffer.from(event.data).toString('hex')]);
            }

            array.push([key.toString(), innerArray]);
        }

        return array;
    }

    private convertLoadedStorageToArray(storage: AddressMap<PointerStorage>): LoadedStorageList {
        const array: LoadedStorageList = {};

        for (const [key, value] of storage) {
            const innerArray: string[] = [];
            for (const innerKey of value.keys()) {
                innerArray.push(
                    Buffer.from(BufferHelper.pointerToUint8Array(innerKey)).toString('base64'),
                );
            }

            array[key.toHex()] = innerArray;
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

            array.push([key.toHex(), innerArray]);
        }

        return array;
    }

    private send(data: object): void {
        if (!process.send) throw new Error('process.send is not a function');

        process.send(data);
    }

    private onBlockChange(blockHeight: bigint): void {
        if (this.currentBlockHeight === blockHeight) {
            return;
        }

        this.currentBlockHeight = blockHeight;
        OPNetConsensus.setBlockHeight(this.currentBlockHeight);
    }

    private async setBlockHeight(): Promise<void> {
        this.vmStorage.blockchainRepository.watchBlockChanges(this.onBlockChange.bind(this));

        try {
            const currentBlock = await this.bitcoinRPC.getBlockHeight();
            this.onBlockChange(BigInt(currentBlock?.blockHeight || 0) + 1n);
        } catch (e) {
            this.error(`(Invalid RPC node) Failed to get current block height. ${e}`);
        }
    }

    private async createVMManagers(): Promise<void> {
        for (let i = 0; i < this.CONCURRENT_VMS; i++) {
            const vmManager: VMManager = new VMManager(Config, true, this.vmStorage);
            await vmManager.init();

            this.vmManagers.push(vmManager);
        }

        setInterval(async () => {
            for (let i = 0; i < this.vmManagers.length; i++) {
                const vmManager = this.vmManagers[i];
                await vmManager.clear();
            }

            Blockchain.purgeCached();
        }, 20000);
    }

    private parseTransaction(
        transaction: SimulatedTransaction | undefined,
    ): ParsedSimulatedTransaction | undefined {
        if (!transaction) {
            return;
        }

        return {
            inputs: transaction.inputs.map((input) => {
                return {
                    txId: Buffer.from(input.txId, 'base64'),
                    outputIndex: input.outputIndex,
                    scriptSig: Buffer.from(input.scriptSig, 'base64'),
                    coinbase: input.coinbase ? Buffer.from(input.coinbase, 'base64') : undefined,
                    flags: input.flags || 0,
                };
            }),
            outputs: [
                ...[
                    {
                        value: 10000000n,
                        index: 0,
                        to: 'tb1pff6z2u3jvy0c206nkwsxm2d7xzuuyfq337w6dxgrgmgt3my2ayzsquka3w',
                        flags: TransactionOutputFlags.hasTo,
                        scriptPubKey: undefined,
                    },
                    {
                        value: 10000000n,
                        index: 1,
                        to: '2N3boRkKs7YUXgzsKC9THBMDU622dWNn7T3',
                        flags: TransactionOutputFlags.hasTo,
                        scriptPubKey: undefined,
                    },
                ],
                ...transaction.outputs.map((output) => {
                    return {
                        value: BigInt(output.value),
                        index: output.index,
                        to: output.to,
                        flags: output.flags || 0,
                        scriptPubKey: output.scriptPubKey
                            ? Buffer.from(output.scriptPubKey, 'base64')
                            : undefined,
                    };
                }),
            ],
        };
    }

    private parseStorageList(storageList: LoadedStorageList | undefined): AddressMap<Uint8Array[]> {
        const storageMap: AddressMap<Uint8Array[]> = new AddressMap();

        if (!storageList) {
            return storageMap;
        }

        for (const [key, value] of Object.entries(storageList)) {
            const address = Address.fromString(key);

            const innerMap: Uint8Array[] = value.map((innerValue: string) => {
                return Buffer.from(innerValue, 'base64');
            });

            storageMap.set(address, innerMap);
        }

        return storageMap;
    }

    private async onCallRequest(
        data: CallRequestData,
    ): Promise<EvaluatedResult | CallRequestError | undefined> {
        if (!data.calldata || !data.to) {
            return {
                error: 'Invalid call request data',
            };
        }

        if (Config.DEBUG_LEVEL >= DebugLevel.TRACE) {
            this.info(
                `Call request received. {To: ${data.to.toString()}, Calldata: ${data.calldata}}`,
            );
        }

        const vmManager = await this.getNextVMManager();

        let result: CallRequestResponse | undefined;
        try {
            const parsedTransaction = this.parseTransaction(data.transaction);
            return await vmManager.execute(
                data.to,
                data.from ? Address.fromString(data.from) : BTC_FAKE_ADDRESS,
                Buffer.from(data.calldata, 'hex'),
                data.blockNumber,
                parsedTransaction,
                data.accessList,
                this.parseStorageList(data.preloadStorage),
            );
        } catch (e) {
            const error = e as Error;
            if (Config.DEV_MODE) {
                this.error(`Failed to execute call request (subworker). ${error.stack}`);
            }

            result = {
                error: error.message || 'Unknown error',
            };
        }

        return result;
    }
}

await new RPCManager().init();
