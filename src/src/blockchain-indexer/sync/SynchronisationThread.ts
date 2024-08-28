import { Thread } from '../../threading/thread/Thread.js';
import { ThreadMessageBase } from '../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { DBManagerInstance } from '../../db/DBManager.js';

import { ThreadTypes } from '../../threading/thread/enums/ThreadTypes.js';
import { ThreadData } from '../../threading/interfaces/ThreadData.js';
import { MessageType } from '../../threading/enum/MessageType.js';
import { BlockchainNotifier } from './classes/BlockchainNotifier.js';

export class SynchronisationThread extends Thread<ThreadTypes.SYNCHRONISATION> {
    public readonly threadType: ThreadTypes.SYNCHRONISATION = ThreadTypes.SYNCHRONISATION;

    private readonly blockchainNotifier: BlockchainNotifier = new BlockchainNotifier();

    constructor() {
        super();

        void this.init();
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {
        //console.log(`SynchronisationThread: Received message:`, message);
    }

    protected async init(): Promise<void> {
        this.log(`Starting up blockchain indexer thread...`);

        this.blockchainNotifier.sendMessageToThread = this.sendMessageToThread.bind(this);

        await DBManagerInstance.setup();
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
