import { BitcoinRawTransactionParams, BitcoinRPC } from '@btc-vision/bsi-bitcoin-rpc';
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
import { OPNetConsensus } from '../../../poa/configurations/OPNetConsensus.js';
import { RPCSubWorkerManager } from './RPCSubWorkerManager.js';
import {
    BlockchainStorageMap,
    EvaluatedEvents,
    PointerStorageMap,
} from '../../../vm/evaluated/EvaluatedResult.js';
import { Address, NetEvent } from '@btc-vision/bsi-binary';
import { BlockHeaderValidator } from '../../../vm/BlockHeaderValidator.js';
import { VMMongoStorage } from '../../../vm/storage/databases/VMMongoStorage.js';

export class BitcoinRPCThread extends Thread<ThreadTypes.RPC> {
    public readonly threadType: ThreadTypes.RPC = ThreadTypes.RPC;

    private readonly bitcoinRPC: BitcoinRPC = new BitcoinRPC(1000, false);
    private readonly vmStorage: VMMongoStorage = new VMMongoStorage(Config);

    private blockHeaderValidator: BlockHeaderValidator;
    private currentBlockHeight: bigint = 0n;

    private readonly rpcSubWorkerManager: RPCSubWorkerManager = new RPCSubWorkerManager();

    constructor() {
        super();

        this.vmStorage = new VMMongoStorage(Config);
        this.blockHeaderValidator = new BlockHeaderValidator(Config, this.vmStorage);

        void this.init();
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {}

    protected async init(): Promise<void> {
        await this.vmStorage.init();

        await this.bitcoinRPC.init(Config.BLOCKCHAIN);
        await this.setBlockHeight();

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
            case ThreadTypes.POA: {
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
        }, 1000);
    }

    private async onCallRequest(data: CallRequestData): Promise<CallRequestResponse | undefined> {
        const response = (await this.rpcSubWorkerManager.resolve(data, 'call')) as
            | (Omit<CallRequestResponse, 'response'> & {
                  result: string | Uint8Array;
              })
            | undefined;

        if (!response) {
            return;
        }

        if (response && !('error' in response)) {
            if (typeof response.result === 'string') {
                response.result = Uint8Array.from(Buffer.from(response.result, 'hex'));
            }

            // @ts-expect-error - TODO: Fix this.
            response.gasUsed = response.gasUsed ? BigInt(response.gasUsed as string) : null;

            // @ts-expect-error - TODO: Fix this.
            response.changedStorage = response.changedStorage
                ? // @ts-expect-error - TODO: Fix this.
                  this.convertArrayToMap(response.changedStorage as [string, [string, string][]][])
                : null;

            // @ts-expect-error - TODO: Fix this.
            response.events = response.events
                ? this.convertArrayEventsToEvents(
                      // @ts-expect-error - TODO: Fix this.
                      response.events as [string, [string, string, string][]][],
                  )
                : null;

            // @ts-expect-error - TODO: Fix this.
            response.deployedContracts = [];
        }

        return response as unknown as CallRequestResponse;
    }

    private convertArrayEventsToEvents(
        array: [string, [string, string, string][]][],
    ): EvaluatedEvents {
        const map: EvaluatedEvents = new Map<Address, NetEvent[]>();

        for (const [key, value] of array) {
            const events: NetEvent[] = [];

            for (let i = 0; i < value.length; i++) {
                const innerValue = value[i];
                const event: NetEvent = new NetEvent(
                    innerValue[0],
                    BigInt(innerValue[1]),
                    Uint8Array.from(Buffer.from(innerValue[2], 'hex')),
                );

                events.push(event);
            }

            map.set(key, events);
        }

        return map;
    }

    private convertArrayToMap(array: [string, [string, string][]][]): BlockchainStorageMap {
        const map: BlockchainStorageMap = new Map<string, PointerStorageMap>();

        for (const [key, value] of array) {
            const innerMap: PointerStorageMap = new Map<bigint, bigint>();

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

            const [hasValidProofs, fetchedBlockHeader] = await Promise.all(requests);
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
                return await this.broadcastTransaction(message.data as BroadcastRequest);
            }

            default:
                this.error(`Unknown API message received. {Type: ${message.type}}`);
                break;
        }
    }
}

new BitcoinRPCThread();
