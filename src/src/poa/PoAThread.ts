import { MessageType } from '../threading/enum/MessageType.js';
import { ThreadMessageBase } from '../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadTypes } from '../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../threading/thread/Thread.js';

export class PoAThread extends Thread<ThreadTypes.PoA> {
    public readonly threadType: ThreadTypes.PoA = ThreadTypes.PoA;

    constructor() {
        super();

        void this.init();
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {}

    protected async init(): Promise<void> {
        this.log('PoA Thread started.');
    }

    protected async onLinkMessage(
        _type: ThreadTypes,
        _m: ThreadMessageBase<MessageType>,
    ): Promise<void> {}
}

new PoAThread();
