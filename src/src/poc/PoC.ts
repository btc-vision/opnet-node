import { Logger } from '@btc-vision/bsi-common';
import { BtcIndexerConfig } from '../config/BtcIndexerConfig.js';
import { MessageType } from '../threading/enum/MessageType.js';
import { BlockProcessedMessage } from '../threading/interfaces/thread-messages/messages/indexer/BlockProcessed.js';
import { ThreadMessageBase } from '../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../threading/interfaces/ThreadData.js';
import { ThreadTypes } from '../threading/thread/enums/ThreadTypes.js';
import { P2PManager } from './networking/P2PManager.js';
import { RPCMessage } from '../threading/interfaces/thread-messages/messages/api/RPCMessage.js';
import { BitcoinRPCThreadMessageType } from '../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { OPNetBroadcastData } from '../threading/interfaces/thread-messages/messages/api/BroadcastTransactionOPNet.js';
import { IBlockHeaderWitness } from './networking/protobuf/packets/blockchain/common/BlockHeaderWitness.js';
import { btrace } from '../utils/BroadcastTrace.js';

export class PoC extends Logger {
    public readonly logColor: string = '#00ffe1';

    private readonly p2p: P2PManager;

    /** Serializes onBlockProcessed calls so each completes before the next starts. */
    private blockProcessedLock: Promise<void> = Promise.resolve();

    constructor(private readonly config: BtcIndexerConfig) {
        super();

        this.p2p = new P2PManager(this.config);
        this.p2p.sendMessageToThread = this.internalSendMessageToThread.bind(this);
        this.p2p.sendMessageToAllThreads = this.internalSendMessageToAllThreads.bind(this);
    }

    public async init(): Promise<void> {
        this.log(`Starting PoC...`);

        await this.p2p.init();
    }

    public sendMessageToThread: (
        threadType: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ) => Promise<ThreadData | null> = () => {
        throw new Error('sendMessageToThread not implemented.');
    };

    public sendMessageToAllThreads: (
        threadType: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ) => Promise<void> = () => {
        throw new Error('sendMessageToAllThreads not implemented.');
    };

    public async handleBitcoinIndexerMessage(
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData> {
        btrace('PoC.handleBitcoinIndexerMessage', `ENTER msgType=${m.type}`);
        switch (m.type) {
            case MessageType.BLOCK_PROCESSED: {
                return this.onBlockProcessed(m as BlockProcessedMessage);
            }
            case MessageType.RPC_METHOD: {
                return this.handleRPCMessage(m as RPCMessage<BitcoinRPCThreadMessageType>);
            }
            case MessageType.GET_PEERS: {
                return await this.handleGetPeerMessage();
            }
            default:
                throw new Error(`Unknown message type: ${m.type} received in PoC.`);
        }
    }

    public async broadcastBlockWitness(witness: IBlockHeaderWitness): Promise<void> {
        await this.p2p.broadcastBlockWitnessToNetwork(witness);
    }

    public async requestPeerWitnesses(blockNumber: bigint): Promise<void> {
        await this.p2p.requestWitnessesFromPeers(blockNumber);
    }

    private async handleGetPeerMessage(): Promise<ThreadData> {
        const peers = await this.p2p.getOPNetPeers();

        return { peers };
    }

    private handleRPCMessage(m: RPCMessage<BitcoinRPCThreadMessageType>): ThreadData {
        btrace('PoC.handleRPCMessage', `ENTER rpcMethod=${m.data.rpcMethod}`);
        switch (m.data.rpcMethod) {
            case BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET: {
                const data = m.data.data as OPNetBroadcastData;
                btrace('PoC.handleRPCMessage', `BROADCAST_TRANSACTION_OPNET id=${data.id}`);
                const result = this.p2p.broadcastTransaction(data);
                btrace(
                    'PoC.handleRPCMessage',
                    `broadcastTransaction RETURNED id=${data.id}`,
                    result,
                );
                return result;
            }
            default: {
                throw new Error(`Unknown RPC method: ${m.data.rpcMethod} received in PoC.`);
            }
        }
    }

    private internalSendMessageToThread(
        threadType: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | null> {
        return this.sendMessageToThread(threadType, m);
    }

    private internalSendMessageToAllThreads(
        threadType: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<void> {
        return this.sendMessageToAllThreads(threadType, m);
    }

    private async onBlockProcessed(m: BlockProcessedMessage): Promise<ThreadData> {
        const block = m.data.blockNumber;
        btrace('PoC.onBlockProcessed', `ENTER block=${block} -> awaiting previous blockProcessedLock`);

        await this.blockProcessedLock.catch(() => {});
        btrace('PoC.onBlockProcessed', `block=${block} previous lock released, sending WITNESS_HEIGHT_UPDATE to ALL witness threads`);

        this.blockProcessedLock = this.sendMessageToAllThreads(ThreadTypes.WITNESS, {
            type: MessageType.WITNESS_HEIGHT_UPDATE,
            data: { blockNumber: m.data.blockNumber },
        });

        try {
            await this.blockProcessedLock;
            btrace('PoC.onBlockProcessed', `block=${block} WITNESS_HEIGHT_UPDATE round-trip COMPLETE`);
        } catch (e: unknown) {
            btrace('PoC.onBlockProcessed', `block=${block} WITNESS_HEIGHT_UPDATE FAILED`);
            this.error(`Failed to broadcast height update: ${(e as Error).stack}`);
        }

        btrace('PoC.onBlockProcessed', `block=${block} dispatching WITNESS_BLOCK_PROCESSED (fire-and-forget)`);
        void this.sendMessageToThread(ThreadTypes.WITNESS, {
            type: MessageType.WITNESS_BLOCK_PROCESSED,
            data: m.data,
        }).catch((e: unknown) => {
            this.error(`Failed to dispatch WITNESS_BLOCK_PROCESSED: ${(e as Error).stack}`);
        });

        this.p2p.updateConsensusHeight(m.data.blockNumber);

        btrace('PoC.onBlockProcessed', `block=${block} RETURNING ack to indexer`);
        return {};
    }
}
