import { BitcoinRawTransactionParams, BitcoinRPC } from '@btc-vision/bitcoin-rpc';
import { fromHex } from '@btc-vision/bitcoin';
import { DataConverter } from '@btc-vision/bsi-common';
import { Config } from '../../../config/Config.js';
import {
    BlockHeaderChecksumProof,
    BlockHeaderDocument,
} from '../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { ChecksumProof } from '../../../poc/networking/protobuf/packets/blockchain/common/BlockHeaderWitness.js';
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
import { RPCSubWorkerManager } from './RPCSubWorkerManager.js';
import { PointerStorageMap } from '../../../vm/evaluated/EvaluatedResult.js';
import { NetEvent } from '@btc-vision/transaction';
import { BlockHeaderValidator } from '../../../vm/BlockHeaderValidator.js';
import { VMMongoStorage } from '../../../vm/storage/databases/VMMongoStorage.js';
import { LoadedStorageList } from '../../../api/json-rpc/types/interfaces/results/states/CallResult.js';
import { OPNetConsensus } from '../../../poc/configurations/OPNetConsensus.js';

export class BitcoinRPCThread extends Thread<ThreadTypes.RPC> {
    public readonly threadType: ThreadTypes.RPC = ThreadTypes.RPC;

    private readonly bitcoinRPC: BitcoinRPC = new BitcoinRPC(1500, false);
    private readonly vmStorage: VMMongoStorage = new VMMongoStorage(Config);

    private blockHeaderValidator: BlockHeaderValidator;

    private readonly rpcSubWorkerManager: RPCSubWorkerManager = new RPCSubWorkerManager();

    constructor() {
        super();

        OPNetConsensus.setBlockHeight(0n, false);

        this.vmStorage = new VMMongoStorage(Config);
        this.blockHeaderValidator = new BlockHeaderValidator(Config, this.vmStorage, false);

        void this.init();
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {}

    protected async init(): Promise<void> {
        await this.vmStorage.init();
        await this.bitcoinRPC.init(Config.BLOCKCHAIN);

        this.rpcSubWorkerManager.startWorkers();
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

    private async onCallRequest(data: CallRequestData): Promise<CallRequestResponse | undefined> {
        const response = (await this.rpcSubWorkerManager.resolve(data, 'call')) as
            | {
                  result: string | Uint8Array;
                  revert?: string | Uint8Array;
                  changedStorage: [string, [string, string][]][] | null;
                  loadedStorage: LoadedStorageList;
                  gasUsed: string | null;
                  specialGasUsed: string | null;
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
            let revertData: Uint8Array | undefined;

            if (response.revert) {
                revertData =
                    typeof response.revert === 'string'
                        ? fromHex(response.revert)
                        : response.revert;
            }

            return {
                ...response,
                changedStorage: response.changedStorage
                    ? this.convertArrayToMap(response.changedStorage)
                    : undefined,
                loadedStorage: response.loadedStorage || {},
                gasUsed: response.gasUsed ? BigInt(response.gasUsed) : 0n,
                specialGasUsed: response.specialGasUsed ? BigInt(response.specialGasUsed) : 0n,
                events: response.events
                    ? this.convertArrayEventsToEvents(response.events)
                    : undefined,
                result:
                    typeof response.result === 'string'
                        ? fromHex(response.result)
                        : response.result,
                revert: revertData,
                deployedContracts: [],
            };
        } else {
            return {
                error: response.error,
            };
        }
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
                    fromHex(innerValue[1]),
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

        if (result) {
            response.result = result;
        }

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
