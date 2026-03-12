import { Worker } from 'worker_threads';
import { MessageType } from '../../threading/enum/MessageType.js';
import {
    LinkThreadMessage,
    LinkType,
} from '../../threading/interfaces/thread-messages/messages/LinkThreadMessage.js';
import { LinkThreadRequestMessage } from '../../threading/interfaces/thread-messages/messages/LinkThreadRequestMessage.js';
import { ThreadMessageBase } from '../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadManager } from '../../threading/manager/ThreadManager.js';
import { ThreadTypes } from '../../threading/thread/enums/ThreadTypes.js';
import { Threader } from '../../threading/Threader.js';

export class WitnessThreadManager extends ThreadManager<ThreadTypes.WITNESS> {
    public readonly logColor: string = '#e2ef37';

    protected readonly threadManager: Threader<ThreadTypes.WITNESS> = new Threader(
        ThreadTypes.WITNESS,
    );

    constructor() {
        super();
        void this.createAllThreads();
    }

    public onGlobalMessage(_msg: ThreadMessageBase<MessageType>, _thread: Worker): Promise<void> {
        throw new Error('Method not implemented.');
    }

    protected sendLinkToThreadsOfType(
        _threadType: ThreadTypes,
        _threadId: number,
        message: LinkThreadMessage<LinkType>,
    ): Promise<boolean> | boolean {
        const targetThreadType = message.data.targetThreadType;
        switch (targetThreadType) {
            default: {
                return false;
            }
        }
    }

    protected sendLinkMessageToThreadOfType(
        threadType: ThreadTypes,
        _message: LinkThreadRequestMessage,
    ): Promise<boolean> | boolean {
        switch (threadType) {
            default: {
                return false;
            }
        }
    }

    protected onExitRequested(): void {
        this.threadManager.sendToAllThreads({
            type: MessageType.EXIT_THREAD,
        });
    }

    protected async createLinkBetweenThreads(): Promise<void> {
        // Link to P2P: receives forwarded BLOCK_PROCESSED and peer witness data
        await this.threadManager.createLinkBetweenThreads(ThreadTypes.P2P);

        // No INDEXER link is needed. The WitnessThread never calls
        // getCurrentBlock() (which would require an INDEXER link); instead,
        // it receives block height via WITNESS_BLOCK_PROCESSED from the P2P
        // thread. Peer witnesses arriving before the first BLOCK_PROCESSED
        // are buffered in WitnessThread and replayed once the height is set.
        //
        // CHAIN_REORG is also not forwarded explicitly. Reorgs are detected
        // implicitly: when the indexer reverts, it re-sends a lower-height
        // BLOCK_PROCESSED which triggers revertKnownWitnessesReorg() inside
        // the self-witness queue processor (currentBlock >= data.blockNumber).
        // In the brief window between reorg and the next BLOCK_PROCESSED,
        // peer witnesses for reverted blocks will fail RPC validation against
        // the updated chain, so no invalid witnesses are stored.
    }

    private async createAllThreads(): Promise<void> {
        this.init();
        await this.threadManager.createThreads();
    }
}

new WitnessThreadManager();
