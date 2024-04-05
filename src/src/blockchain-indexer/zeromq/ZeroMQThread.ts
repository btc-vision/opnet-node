import { MessageType } from '../../threading/enum/MessageType.js';
import { ThreadMessageBase } from '../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadTypes } from '../../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../../threading/thread/Thread.js';

export class ZeroMQThread extends Thread<ThreadTypes.ZERO_MQ> {
    public readonly threadType: ThreadTypes.ZERO_MQ = ThreadTypes.ZERO_MQ;

    constructor() {
        super();
    }

    protected async onMessage(message: any): Promise<void> {}

    protected async init(): Promise<void> {}

    protected async onLinkMessage(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<void> {}
}

new ZeroMQThread();
