import { parentPort, Worker } from 'worker_threads';
import { MessageType } from '../threading/enum/MessageType.js';
import {
    LinkThreadMessage,
    LinkType,
} from '../threading/interfaces/thread-messages/messages/LinkThreadMessage.js';
import { LinkThreadRequestMessage } from '../threading/interfaces/thread-messages/messages/LinkThreadRequestMessage.js';
import { ThreadMessageBase } from '../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadManager } from '../threading/manager/ThreadManager.js';
import { ThreadTypes } from '../threading/thread/enums/ThreadTypes.js';
import { Threader } from '../threading/Threader.js';

export class PluginThreadManager extends ThreadManager<ThreadTypes.PLUGIN> {
    public readonly logColor: string = '#673AB7';

    protected readonly threadManager: Threader<ThreadTypes.PLUGIN> = new Threader(
        ThreadTypes.PLUGIN,
    );

    constructor() {
        super();

        this.init();
    }

    protected onGlobalMessage(msg: ThreadMessageBase<MessageType>, _thread: Worker): void {
        switch (msg.type) {
            case MessageType.PLUGIN_READY:
                this.log('Plugin thread ready');
                // Forward to Core so it can continue starting other threads
                if (parentPort) {
                    parentPort.postMessage(msg);
                }
                break;
            default:
                this.warn(`Unknown message type: ${msg.type}`);
                break;
        }
    }

    protected async createLinkBetweenThreads(): Promise<void> {
        await this.threadManager.createLinkBetweenThreads(ThreadTypes.INDEXER);
        await this.threadManager.createLinkBetweenThreads(ThreadTypes.API);
    }

    protected sendLinkToThreadsOfType(
        threadType: ThreadTypes,
        _threadId: number,
        _message: LinkThreadMessage<LinkType>,
    ): boolean {
        switch (threadType) {
            default:
                return false;
        }
    }

    protected onExitRequested(): void {
        this.threadManager.sendToAllThreads({
            type: MessageType.EXIT_THREAD,
        });
    }

    protected sendLinkMessageToThreadOfType(
        threadType: ThreadTypes,
        _message: LinkThreadRequestMessage,
    ): boolean {
        switch (threadType) {
            default:
                return false;
        }
    }
}

const pluginManager = new PluginThreadManager();
await pluginManager.createThreads();
