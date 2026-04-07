import { describe, expect, it, vi } from 'vitest';
import { ReusableStream } from '../../../src/src/poc/networking/stream/ReusableStream.js';

type QueueItem = {
    data: Uint8Array;
    resolve: () => void;
    reject: (err: unknown) => void;
};

class InjectOnEmptyQueue {
    [index: number]: QueueItem | undefined;

    private items: QueueItem[] = [];
    private injected = false;

    constructor(private readonly onEmptyObserved: () => void) {}

    public get length(): number {
        if (this.items.length === 0 && !this.injected) {
            this.injected = true;
            this.onEmptyObserved();
            return 0;
        }

        return this.items.length;
    }

    public push(item: QueueItem): number {
        this.items.push(item);
        this.syncHead();
        return this.items.length;
    }

    public shift(): QueueItem | undefined {
        const item = this.items.shift();
        this.syncHead();
        return item;
    }

    private syncHead(): void {
        this[0] = this.items[0];
    }
}

function createMockStream() {
    return {
        id: 'stream-1',
        writableNeedsDrain: false,
        send: vi.fn(),
        onDrain: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    };
}

describe('ReusableStream', () => {
    it('continues draining when a message is enqueued during queue shutdown window', async () => {
        const mockStream = createMockStream();
        const stream = new ReusableStream(
            { toString: () => 'peer-1' } as never,
            '/opnet/test',
            mockStream as never,
            {
                idleTimeoutMs: 0,
                maxMessageSize: 1024,
                isInbound: false,
            },
            'stream-key',
            vi.fn(),
        );

        let secondMessagePromise: Promise<void> | undefined;
        const secondPayload = Uint8Array.of(0x02);

        (stream as never as { messageQueue: InjectOnEmptyQueue }).messageQueue =
            new InjectOnEmptyQueue(() => {
                secondMessagePromise = stream.sendMessage(secondPayload);
            });

        const firstPayload = Uint8Array.of(0x01);
        const firstMessagePromise = stream.sendMessage(firstPayload);

        await firstMessagePromise;

        await Promise.race([
            secondMessagePromise,
            new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('second message remained stuck in queue')), 100);
            }),
        ]);

        expect(mockStream.send).toHaveBeenCalledTimes(2);
        expect(mockStream.send).toHaveBeenCalledWith(firstPayload);
        expect(mockStream.send).toHaveBeenCalledWith(secondPayload);
    });
});
