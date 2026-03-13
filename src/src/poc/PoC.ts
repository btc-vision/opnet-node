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
        switch (m.type) {
            case MessageType.BLOCK_PROCESSED: {
                return await this.onBlockProcessed(m as BlockProcessedMessage);
            }
            case MessageType.RPC_METHOD: {
                return await this.handleRPCMessage(m as RPCMessage<BitcoinRPCThreadMessageType>);
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

    private async handleRPCMessage(
        m: RPCMessage<BitcoinRPCThreadMessageType>,
    ): Promise<ThreadData> {
        switch (m.data.rpcMethod) {
            case BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET: {
                return await this.p2p.broadcastTransaction(m.data.data as OPNetBroadcastData);
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
        // Wait for previous block to finish so height + proof are always in order.
        // Use catch so a failed broadcast doesn't permanently jam the lock.
        await this.blockProcessedLock.catch(() => {});

        // Broadcast height to ALL witness instances
        this.blockProcessedLock = this.sendMessageToAllThreads(ThreadTypes.WITNESS, {
            type: MessageType.WITNESS_HEIGHT_UPDATE,
            data: { blockNumber: m.data.blockNumber },
        });

        try {
            await this.blockProcessedLock;
        } catch (e: unknown) {
            this.error(`Failed to broadcast height update: ${(e as Error).stack}`);
        }

        // Round-robin proof generation to ONE witness instance
        void this.sendMessageToThread(ThreadTypes.WITNESS, {
            type: MessageType.WITNESS_BLOCK_PROCESSED,
            data: m.data,
        }).catch((e: unknown) => {
            this.error(`Failed to dispatch WITNESS_BLOCK_PROCESSED: ${(e as Error).stack}`);
        });

        // Update consensus height on this thread
        this.p2p.updateConsensusHeight(m.data.blockNumber);

        return {};
    }
}
