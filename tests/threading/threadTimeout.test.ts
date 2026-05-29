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

    public receiveForTest(
        m: ThreadMessageBase<MessageType>,
        threadType: ThreadTypes,
        port: MessagePort,
    ): Promise<void> {
        return (
            this as unknown as {
                onEventMessage: (
                    m: ThreadMessageBase<MessageType>,
                    threadType: ThreadTypes,
                    port: MessagePort,
                ) => Promise<void>;
            }
        ).onEventMessage(m, threadType, port);
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

    it('always replies to a request even when the handler returns undefined', async () => {
        // onLinkMessage in TestThread returns undefined. Before the fix this
        // produced NO reply, leaving the caller hanging on its 240s timeout.
        const { port1, port2 } = new MessageChannel();
        const thread = new TestThread();

        const message: ThreadMessageBase<MessageType.RPC_METHOD> = {
            type: MessageType.RPC_METHOD,
            taskId: 'abc123',
            data: { rpcMethod: 5, data: { raw: new Uint8Array(), psbt: false, id: 'x' } },
        };

        try {
            const reply = new Promise<ThreadMessageBase<MessageType>>((resolve) => {
                port2.once('message', (m: ThreadMessageBase<MessageType>) => resolve(m));
            });

            await thread.receiveForTest(message, ThreadTypes.P2P, port1);

            const resp = await reply;
            expect(resp.type).toBe(MessageType.THREAD_RESPONSE);
            expect(resp.taskId).toBe('abc123');
            expect(resp.data).toEqual({});
        } finally {
            port1.close();
            port2.close();
        }
    });

    it('does not bounce a reply back to a THREAD_RESPONSE message', async () => {
        // A THREAD_RESPONSE carries a taskId but is itself a reply; re-replying
        // would ping a dead taskId back at the sender.
        const { port1, port2 } = new MessageChannel();
        const thread = new TestThread();

        const response: ThreadMessageBase<MessageType.THREAD_RESPONSE> = {
            type: MessageType.THREAD_RESPONSE,
            taskId: 'def456',
            data: {},
        };

        try {
            let bounced = false;
            port2.once('message', () => {
                bounced = true;
            });

            await thread.receiveForTest(response, ThreadTypes.P2P, port1);
            await new Promise((resolve) => setImmediate(resolve));

            expect(bounced).toBe(false);
        } finally {
            port1.close();
            port2.close();
        }
    });
});
