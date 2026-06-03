import { MessageType } from '../threading/enum/MessageType.js';
import { ThreadMessageBase } from '../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../threading/interfaces/ThreadData.js';
import { ThreadTypes } from '../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../threading/thread/Thread.js';
import { BlockIndexer } from './processor/BlockIndexer.js';
import { installBitcoinRPCTimeout } from './rpc/RPCTimeout.js';

export class BlockchainIndexerThread extends Thread<ThreadTypes.INDEXER> {
    public readonly threadType: ThreadTypes.INDEXER = ThreadTypes.INDEXER;

    private readonly blockIndexer: BlockIndexer = new BlockIndexer();

    constructor() {
        super();

        void this.init();
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {}

    protected init(): Promise<void> | void {
        this.log(`Starting up blockchain indexer thread...`);

        // Bound time-to-first-byte so an unresponsive Bitcoin Core fails fast.
        // bodyTimeout is disabled (0): this worker streams large blocks via
        // getblockbatch and must not abort a slow large-body download mid-stream.
        installBitcoinRPCTimeout(undefined, 0);

        this.blockIndexer.sendMessageToThread = this.sendMessageToThread.bind(this);
        this.blockIndexer.sendMessageToAllThreads = this.sendMessageToAllThreads.bind(this);
    }

    protected async onLinkMessage(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | undefined> {
        switch (type) {
            case ThreadTypes.P2P: {
                return this.onPoCMessage(m);
            }

            default:
                throw new Error(
                    `Unknown message type: ${type} received in BlockchainIndexerThread.`,
                );
        }
    }

    private onPoCMessage(
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | undefined> | ThreadData | undefined {
        return this.blockIndexer.handleMessage(m);
    }
}

new BlockchainIndexerThread();
