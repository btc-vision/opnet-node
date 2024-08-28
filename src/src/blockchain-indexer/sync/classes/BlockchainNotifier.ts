import { Logger } from '@btc-vision/bsi-common';
import { ThreadTypes } from '../../../threading/thread/enums/ThreadTypes.js';
import { ThreadMessageBase } from '../../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { MessageType } from '../../../threading/enum/MessageType.js';
import { ThreadData } from '../../../threading/interfaces/ThreadData.js';
import { Network } from 'bitcoinjs-lib';
import { NetworkConverter } from '../../../config/network/NetworkConverter.js';
import { Config } from '../../../config/Config.js';

export class BlockchainNotifier extends Logger {
    public readonly logColor: string = '#00ffe1';

    private readonly network: Network = NetworkConverter.getNetwork();

    constructor() {
        super();
    }

    public sendMessageToThread: (
        type: ThreadTypes,
        message: ThreadMessageBase<MessageType>,
    ) => Promise<ThreadData | null> = async () => {
        throw new Error('sendMessageToThread not implemented.');
    };

    public async init(): Promise<void> {}

    public async handleMessage(m: ThreadMessageBase<MessageType>): Promise<ThreadData> {
        let resp: ThreadData;
        switch (m.type) {
            case MessageType.START_INDEXER: {
                resp = await this.startIndexer();
                break;
            }
            default:
                throw new Error(`Unknown message type: ${m.type} received in PoA.`);
        }

        return resp ?? null;
    }

    private async startIndexer(): Promise<ThreadData> {
        if (Config.P2P.IS_BOOTSTRAP_NODE) {
            return {
                started: true,
            };
        }

        return {
            started: true,
        };
    }
}
