import { Thread } from '../../threading/thread/Thread.js';
import { ThreadMessageBase } from '../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { DBManagerInstance } from '../../db/DBManager.js';

import { ThreadTypes } from '../../threading/thread/enums/ThreadTypes.js';
import { ThreadData } from '../../threading/interfaces/ThreadData.js';
import { MessageType } from '../../threading/enum/MessageType.js';
import { ChainSynchronisation } from './classes/ChainSynchronisation.js';
import { installBitcoinRPCTimeout } from '../rpc/RPCTimeout.js';

export class SynchronisationThread extends Thread<ThreadTypes.SYNCHRONISATION> {
    public readonly threadType: ThreadTypes.SYNCHRONISATION = ThreadTypes.SYNCHRONISATION;

    private readonly blockchainNotifier: ChainSynchronisation = new ChainSynchronisation();

    constructor() {
        super();

        void this.init();
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {
        //console.log(`SynchronisationThread: Received message:`, message);
    }

    protected async init(): Promise<void> {
        this.log(`Starting up blockchain indexer thread...`);

        // Bound time-to-first-byte so an unresponsive Bitcoin Core fails fast.
        // bodyTimeout is disabled (0): this worker streams large blocks via
        // getblockbatch and must not abort a slow large-body download mid-stream.
        installBitcoinRPCTimeout(undefined, 0);

        this.blockchainNotifier.sendMessageToThread = this.sendMessageToThread.bind(this);

        DBManagerInstance.setup();
        await DBManagerInstance.connect();

        await this.blockchainNotifier.init();

        this.info(`Blockchain indexer thread started.`);
    }

    protected async onLinkMessage(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | undefined> {
        switch (type) {
            case ThreadTypes.INDEXER: {
                return await this.blockchainNotifier.handleMessage(m);
            }
            default:
                throw new Error(`Unknown message type: ${type} received in UnspentUTXOThread.`);
        }
    }
}

new SynchronisationThread();
