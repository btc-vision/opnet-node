import { BitcoinRawTransactionParams, BitcoinRPC } from '@btc-vision/bitcoin-rpc';
import { DataConverter } from '@btc-vision/bsi-db';
import { Config } from '../../../config/Config.js';
import {
    BlockHeaderChecksumProof,
    BlockHeaderDocument,
} from '../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { ChecksumProof } from '../../../poa/networking/protobuf/packets/blockchain/common/BlockHeaderWitness.js';
import { MessageType } from '../../../threading/enum/MessageType.js';
import {
    CallRequestData,
    CallRequestResponse,
} from '../../../threading/interfaces/thread-messages/messages/api/CallRequest.js';
import { RPCMessage } from '../../../threading/interfaces/thread-messages/messages/api/RPCMessage.js';
import {
    BlockDataAtHeightData,
    ValidatedBlockHeader,
} from '../../../threading/interfaces/thread-messages/messages/api/ValidateBlockHeaders.js';
import { ThreadMessageBase } from '../../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../../../threading/interfaces/ThreadData.js';
import { ThreadTypes } from '../../../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../../../threading/thread/Thread.js';
import { BitcoinRPCThreadMessageType } from './messages/BitcoinRPCThreadMessage.js';
import {
    BroadcastRequest,
    BroadcastResponse,
} from '../../../threading/interfaces/thread-messages/messages/api/BroadcastRequest.js';
import {
    BlockchainStorageMap,
    EvaluatedEvents,
    EvaluatedResult,
    PointerStorageMap,
} from '../../../vm/evaluated/EvaluatedResult.js';
import { Address, NetEvent } from '@btc-vision/transaction';
import { BlockHeaderValidator } from '../../../vm/BlockHeaderValidator.js';
import { VMMongoStorage } from '../../../vm/storage/databases/VMMongoStorage.js';
import { VMManager } from '../../../vm/VMManager.js';
import { OPNetConsensus } from '../../../poa/configurations/OPNetConsensus.js';
import { Blockchain } from '../../../vm/Blockchain.js';
import { DebugLevel } from '@btc-vision/logger';
import { BTC_FAKE_ADDRESS } from '../../processor/block/types/ZeroValue.js';
import {
    ParsedSimulatedTransaction,
    SimulatedTransaction,
} from '../../../api/json-rpc/types/interfaces/params/states/CallParams.js';
import { Buffer } from 'buffer';

export class BitcoinRPCThread extends Thread<ThreadTypes.RPC> {
    public readonly threadType: ThreadTypes.RPC = ThreadTypes.RPC;

    private readonly bitcoinRPC: BitcoinRPC = new BitcoinRPC(1500, true);
    private readonly vmStorage: VMMongoStorage = new VMMongoStorage(Config);

    private blockHeaderValidator: BlockHeaderValidator;

    //private readonly rpcSubWorkerManager: RPCSubWorkerManager = new RPCSubWorkerManager();

    private readonly vmManagers: VMManager[] = [];
    private currentVMManagerIndex: number = 0;

    private readonly CONCURRENT_VMS: number = Config.RPC.VM_CONCURRENCY || 1;
    private currentBlockHeight: bigint = 0n;

    constructor() {
        super();

        this.vmStorage = new VMMongoStorage(Config);
        this.blockHeaderValidator = new BlockHeaderValidator(Config, this.vmStorage);

        void this.init();
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {}

    protected async init(): Promise<void> {
        await this.bitcoinRPC.init(Config.BLOCKCHAIN);
        await this.vmStorage.init();

        await this.setBlockHeight();
        await this.createVMManagers();

        //this.rpcSubWorkerManager.startWorkers();
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

    protected async onLinkMessage(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | undefined> {
        if (m.type !== MessageType.RPC_METHOD) throw new Error('Invalid message type');

        switch (type) {
            case ThreadTypes.API: {
                return await this.processAPIMessage(m as RPCMessage<BitcoinRPCThreadMessageType>);
            }
            case ThreadTypes.INDEXER: {
                return await this.processAPIMessage(m as RPCMessage<BitcoinRPCThreadMessageType>);
            }
            case ThreadTypes.P2P: {
                return await this.processAPIMessage(m as RPCMessage<BitcoinRPCThreadMessageType>);
            }
            case ThreadTypes.MEMPOOL: {
                return await this.processAPIMessage(m as RPCMessage<BitcoinRPCThreadMessageType>);
            }
            default:
                this.log(`Unknown thread message received. {Type: ${m.type}}`);
                break;
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
            this.error(`Failed to get current block height. ${e}`);
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /*private async onCallRequest(data: CallRequestData): Promise<CallRequestResponse | undefined> {
        const response = (await this.rpcSubWorkerManager.resolve(data, 'call')) as
            | {
                  result: string | Uint8Array;
                  changedStorage: [string, [string, string][]][] | null;
                  gasUsed: string | null;
                  events: [string, [string, string][]][];
              }
            | {
                  error: string;
              }
            | undefined;

        if (!response) {
            return;
        }

        if (!('error' in response)) {
            return {
                ...response,
                changedStorage: response.changedStorage
                    ? this.convertArrayToMap(response.changedStorage)
                    : undefined,
                gasUsed: response.gasUsed ? BigInt(response.gasUsed) : 0n,
                events: response.events
                    ? this.convertArrayEventsToEvents(response.events)
                    : undefined,
                result:
                    typeof response.result === 'string'
                        ? Uint8Array.from(Buffer.from(response.result, 'hex'))
                        : response.result,
                deployedContracts: [],
            };
        } else {
            return {
                error: response.error,
            };
        }
    }*/

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
                };
            }),
            outputs: [
                ...[
                    {
                        value: 0n,
                        index: 0,
                        to: 'dead',
                    },
                ],
                ...transaction.outputs.map((output) => {
                    return {
                        value: BigInt(output.value),
                        index: output.index,
                        to: output.to,
                    };
                }),
            ],
        };
    }

    private async onCallRequest(data: CallRequestData): Promise<CallRequestResponse | undefined> {
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
            const response: EvaluatedResult = await vmManager.execute(
                data.to,
                data.from ? Address.fromString(data.from) : BTC_FAKE_ADDRESS,
                Buffer.from(data.calldata, 'hex'),
                data.blockNumber,
                parsedTransaction,
                data.accessList,
            );

            result = {
                ...response,
                changedStorage: response.changedStorage
                    ? this.convertArrayToMap(this.convertMapToArray(response.changedStorage))
                    : undefined,
                gasUsed: response.gasUsed ? BigInt(response.gasUsed) : 0n,
                events: response.events
                    ? this.convertArrayEventsToEvents(this.convertEventsToArray(response.events))
                    : undefined,
                result: response.result ? Buffer.from(response.result) : undefined,
                deployedContracts: response.deployedContracts || [],
            };
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

    private convertArrayEventsToEvents(
        array: [string, [string, string][]][],
    ): Map<string, NetEvent[]> {
        const map: Map<string, NetEvent[]> = new Map<string, NetEvent[]>();

        for (const [key, value] of array) {
            const events: NetEvent[] = [];

            for (let i = 0; i < value.length; i++) {
                const innerValue = value[i];
                const event: NetEvent = new NetEvent(
                    innerValue[0],
                    Uint8Array.from(Buffer.from(innerValue[1], 'hex')),
                );

                events.push(event);
            }

            map.set(key, events);
        }

        return map;
    }

    private convertArrayToMap(
        array: [string, [string, string][]][],
    ): Map<string, Map<bigint, bigint>> {
        const map: Map<string, Map<bigint, bigint>> = new Map<string, PointerStorageMap>();

        for (const [key, value] of array) {
            const innerMap: Map<bigint, bigint> = new Map();
            for (const [innerKey, innerValue] of value) {
                innerMap.set(BigInt(innerKey), BigInt(innerValue));
            }

            map.set(key, innerMap);
        }

        return map;
    }

    private async validateBlockHeaders(data: BlockDataAtHeightData): Promise<ValidatedBlockHeader> {
        const blockNumber = BigInt(data.blockNumber);
        const blockHeader = data.blockHeader;

        const vmBlockHeader: Partial<BlockHeaderDocument> = {
            previousBlockHash: blockHeader.previousBlockHash,
            height: DataConverter.toDecimal128(blockNumber),
            receiptRoot: blockHeader.receiptRoot,
            storageRoot: blockHeader.storageRoot,
            hash: blockHeader.blockHash,
            merkleRoot: blockHeader.merkleRoot,
            checksumRoot: blockHeader.checksumHash,
            previousBlockChecksum: blockHeader.previousBlockChecksum,
            checksumProofs: this.getChecksumProofs(blockHeader.checksumProofs),
        };

        try {
            const requests: [
                Promise<boolean | null>,
                Promise<BlockHeaderDocument | undefined | null>,
            ] = [
                this.blockHeaderValidator.validateBlockChecksum(vmBlockHeader),
                this.blockHeaderValidator.getBlockHeader(blockNumber),
            ];

            const [hasValidProofs, fetchedBlockHeader] = await Promise.safeAll(requests);
            return {
                hasValidProofs: hasValidProofs,
                storedBlockHeader: fetchedBlockHeader ?? null,
            };
        } catch {}

        return {
            hasValidProofs: false,
            storedBlockHeader: null,
        };
    }

    private async broadcastTransaction(
        transactionData: BroadcastRequest,
    ): Promise<BroadcastResponse> {
        const response: BroadcastResponse = {
            success: false,
            identifier: 0n,
        };

        if (!transactionData.data.rawTransaction) {
            throw new Error('No raw transaction data provided');
        }

        const result: string | null = await this.bitcoinRPC
            .sendRawTransaction({ hexstring: transactionData.data.rawTransaction })
            .catch((e: unknown) => {
                const error = e as Error;
                response.error = error.message || 'Unknown error';

                return null;
            });

        response.success = result !== null;
        if (result) response.result = result;

        return response;
    }

    private getChecksumProofs(rawProofs: ChecksumProof[]): BlockHeaderChecksumProof {
        const proofs: BlockHeaderChecksumProof = [];

        for (let i = 0; i < rawProofs.length; i++) {
            const proof = rawProofs[i];
            const data: [number, string[]] = [i, proof.proof];

            proofs.push(data);
        }

        return proofs;
    }

    private async processAPIMessage(
        message: RPCMessage<BitcoinRPCThreadMessageType>,
    ): Promise<ThreadData | undefined> {
        const rpcMethod = message.data.rpcMethod;

        switch (rpcMethod) {
            case BitcoinRPCThreadMessageType.GET_CURRENT_BLOCK: {
                return await this.bitcoinRPC.getBlockHeight();
            }

            case BitcoinRPCThreadMessageType.GET_TX: {
                return (
                    (await this.bitcoinRPC.getRawTransaction(
                        message.data.data as BitcoinRawTransactionParams,
                    )) ?? undefined
                );
            }

            case BitcoinRPCThreadMessageType.VALIDATE_BLOCK_HEADERS: {
                return await this.validateBlockHeaders(message.data.data as BlockDataAtHeightData);
            }

            case BitcoinRPCThreadMessageType.CALL: {
                return await this.onCallRequest(message.data.data as CallRequestData);
            }

            case BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_BITCOIN_CORE: {
                try {
                    return await this.broadcastTransaction(message.data as BroadcastRequest);
                } catch (e) {
                    this.error(`Error broadcasting transaction: ${e}`);

                    return {
                        success: false,
                        error: 'Error broadcasting transaction',
                        identifier: 0n,
                    };
                }
            }

            default:
                this.error(`Unknown API message received. {Type: ${message.type}}`);
                break;
        }
    }
}

new BitcoinRPCThread();

process.on('SIGINT', () => {
    console.log('Received SIGINT. Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Shutting down gracefully...');
    process.exit(0);
});
