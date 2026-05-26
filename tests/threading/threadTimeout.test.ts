import { describe, expect, afterEach, it, vi } from 'vitest';
import { MessageChannel, MessagePort } from 'worker_threads';
import { MessageType } from '../../src/src/threading/enum/MessageType.js';
import { ThreadMessageBase } from '../../src/src/threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../../src/src/threading/interfaces/ThreadData.js';
import { Thread } from '../../src/src/threading/thread/Thread.js';
import { ThreadTypes } from '../../src/src/threading/thread/enums/ThreadTypes.js';

vi.mock('../../src/src/config/Config.js', () => ({
    Config: {
        DEV_MODE: false,
        DEBUG_LEVEL: 0,
        DEV: {
            SAVE_TIMEOUTS_TO_FILE: false,
        },
    },
}));

class TestThread extends Thread<ThreadTypes.API> {
    public readonly threadType: ThreadTypes.API = ThreadTypes.API;
    public readonly warnings: string[] = [];

    public sendForTest(
        m: ThreadMessageBase<MessageType>,
        port: MessagePort,
        destThreadType?: ThreadTypes,
    ): Promise<ThreadData | null> {
        return this.sendMessage(m, port, destThreadType);
    }

    public taskCount(): number {
        return (this as unknown as { tasks: { size: number } }).tasks.size;
    }

    public override warn(...args: string[]): void {
        this.warnings.push(args.join(' '));
    }

    protected init(): void {}

    protected async onMessage(_m: ThreadMessageBase<MessageType>): Promise<void> {}

    protected onLinkMessage(
        _type: ThreadTypes,
        _m: ThreadMessageBase<MessageType>,
    ): ThreadData | undefined {
        return undefined;
    }
}

describe('Thread sendMessage timeout handling', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('removes timed-out tasks and logs Uint8Array payloads as compact binary traces', async () => {
        vi.useFakeTimers();

        const { port1, port2 } = new MessageChannel();
        const thread = new TestThread();
        const message: ThreadMessageBase<MessageType.RPC_METHOD> = {
            type: MessageType.RPC_METHOD,
            data: {
                rpcMethod: 5,
                data: {
                    raw: Uint8Array.from([2, 0, 255, 17]),
                    psbt: false,
                    id: 'txid',
                },
            },
        };

        try {
            const resultPromise = thread.sendForTest(message, port1, ThreadTypes.P2P);

            expect(thread.taskCount()).toBe(1);

            await vi.advanceTimersByTimeAsync(240_000);

            await expect(resultPromise).resolves.toBeNull();
            expect(thread.taskCount()).toBe(0);
            expect(thread.warnings).toHaveLength(1);
            expect(thread.warnings[0]).toContain('"type":"Uint8Array"');
            expect(thread.warnings[0]).toContain('"byteLength":4');
            expect(thread.warnings[0]).toContain('"hex":"0200ff11"');
            expect(thread.warnings[0]).not.toContain('"0":2');
        } finally {
            port1.close();
            port2.close();
        }
    });
});
