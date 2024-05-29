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

export class PoA extends Logger {
    public readonly logColor: string = '#00ffe1';

    private readonly p2p: P2PManager;

    constructor(private readonly config: BtcIndexerConfig) {
        super();

        this.p2p = new P2PManager(this.config);
        this.p2p.sendMessageToThread = this.internalSendMessageToThread.bind(this);
    }

    public async init(): Promise<void> {
        this.log(`Starting PoA...`);

        await this.p2p.init();
    }

    public sendMessageToThread: (
        threadType: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ) => Promise<ThreadData | null> = async () => {
        throw new Error('sendMessageToThread not implemented.');
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
            default:
                throw new Error(`Unknown message type: ${m.type} received in PoA.`);
        }
    }

    private async handleRPCMessage(
        m: RPCMessage<BitcoinRPCThreadMessageType>,
    ): Promise<ThreadData> {
        switch (m.data.rpcMethod) {
            case BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET: {
                return await this.p2p.broadcastTransaction(m.data.data as OPNetBroadcastData);
            }
            default: {
                throw new Error(`Unknown RPC method: ${m.data.rpcMethod} received in PoA.`);
            }
        }
    }

    private internalSendMessageToThread(
        threadType: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | null> {
        return this.sendMessageToThread(threadType, m);
    }

    private async onBlockProcessed(m: BlockProcessedMessage): Promise<ThreadData> {
        const data = m.data;

        await this.p2p.generateBlockHeaderProof(data, true);

        return {};
    }
}
