import { Config } from '../config/Config.js';
import { MessageType } from '../threading/enum/MessageType.js';
import { ThreadMessageBase } from '../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadTypes } from '../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../threading/thread/Thread.js';
import { VMManager } from './VMManager.js';

class VMThread extends Thread<ThreadTypes.VM> {
    public readonly threadType: ThreadTypes.VM = ThreadTypes.VM;

    private readonly vmManager: VMManager = new VMManager(Config);

    constructor() {
        super();

        void this.init();
    }

    protected async init(): Promise<void> {
        await this.vmManager.init();
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {}

    protected async onLinkMessage(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<void> {}
}

new VMThread();
