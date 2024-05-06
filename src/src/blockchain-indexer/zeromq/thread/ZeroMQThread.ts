import { MessageType } from '../../../threading/enum/MessageType.js';
import { ThreadMessageBase } from '../../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadTypes } from '../../../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../../../threading/thread/Thread.js';
import { BitcoinZeroMQTopic } from '../enums/BitcoinZeroMQTopic.js';
import { ZeroMQ } from '../ZeroMQ.js';

type ZeroMQSubscriptions = Partial<{
    [key in BitcoinZeroMQTopic]: ZeroMQ<key>;
}>;

export class ZeroMQThread extends Thread<ThreadTypes.ZERO_MQ> {
    public readonly threadType: ThreadTypes.ZERO_MQ = ThreadTypes.ZERO_MQ;

    private readonly subscription: ZeroMQSubscriptions = {};

    constructor() {
        super();

        void this.init();
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {}

    protected async init(): Promise<void> {
        //this.subscription[BitcoinZeroMQTopic.RAWBLOCK] = new NewBlockSubscription();
        //this.subscription[BitcoinZeroMQTopic.HASHTX] = new NewTxSubscription();

        for (const sub in this.subscription) {
            const subscription = this.subscription[sub as BitcoinZeroMQTopic];
            if (!subscription) {
                throw new Error('Subscription not found');
            }

            subscription.sendMessageToThread = this.sendMessageToThread.bind(this);
        }
    }

    protected async onLinkMessage(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<void> {}
}

new ZeroMQThread();
