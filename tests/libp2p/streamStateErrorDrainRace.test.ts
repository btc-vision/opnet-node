import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AbstractMessageStream } from '@libp2p/utils';
import type { MessageStreamInit, SendResult } from '@libp2p/utils';
import { StreamStateError } from '@libp2p/interface';
import { defaultLogger } from '@libp2p/logger';
import { Uint8ArrayList } from 'uint8arraylist';

/**
 * Reproduces the @libp2p/utils AbstractMessageStream "drain microtask" crash
 * that fatally exits any libp2p node using yamux + noise on the default stack.
 *
 * Real-world chain (observed in production OP_NET node):
 *
 *   YamuxStream (substream), extends AbstractMessageStream
 *     ── 'drain' dispatched by AbstractMessageStream.onMuxerDrain
 *     ── continueSendingOnDrain listener fires (line ~97 of source TS)
 *         ── queueMicrotask(() => this.processSendQueue())   ← UNGUARDED
 *             ── processSendQueue() walks down to:
 *                  YamuxStream.sendData
 *                    → YamuxMuxer.sendFrame
 *                      → YamuxMuxer.send (abstract-stream-muxer.js)
 *                        → maConn.send (EncryptedMessageStream from libp2p-noise)
 *                          → throws StreamStateError if writeStatus is closed/closing
 *             ── throw escapes microtask  →  uncaughtException  →  process.exit(1)
 *
 * Between when 'drain' is dispatched and when the queued microtask runs,
 * the underlying secured/TCP connection can finish closing. The
 * `writeStatus` check inside `EncryptedMessageStream.send` fires and the
 * throw becomes uncatchable from application code.
 *
 * This test reduces the chain to its essence by extending AbstractMessageStream
 * directly and making `sendData()` throw the same StreamStateError that the
 * EncryptedMessageStream throws when its writeStatus is 'closed'.
 *
 * Each test asserts the *correct* post-fix behavior, so the REGRESSION tests
 * FAIL today against `@libp2p/utils@7.2.0` and will PASS once the microtask
 * body is guarded (proposal: wrap `processSendQueue()` in try/catch inside
 * `@libp2p/utils/src/abstract-message-stream.ts` around line 102).
 *
 * Tests that pass regardless of the fix are labeled CONTROL or COMPARISON and
 * exist to demonstrate that the harness itself is sound and that the existing
 * partial-return recovery path works.
 */

class TestStream extends AbstractMessageStream {
    public throwOnSend = false;
    /** Bytes that actually reached `sendData` AND were "successfully sent" (no throw). */
    public readonly delivered: Uint8Array[] = [];
    /** Bytes that `sendData` was called with (succeeded or threw). */
    public readonly attempted: Uint8Array[] = [];

    constructor(init: MessageStreamInit) {
        super(init);
    }

    sendData(data: Uint8ArrayList): SendResult {
        const snapshot = data.subarray();
        this.attempted.push(snapshot);
        if (this.throwOnSend) {
            throw new StreamStateError('Cannot write to a stream that is closed');
        }
        this.delivered.push(snapshot);
        return { sentBytes: data.byteLength, canSendMore: true };
    }
}

const makeInit = (): MessageStreamInit => ({
    log: defaultLogger().forComponent('repro:stream'),
    direction: 'outbound',
});

const flushMicrotasks = async (ticks = 3): Promise<void> => {
    for (let i = 0; i < ticks; i++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
};

interface AbstractMessageStreamInternals {
    writeBuffer: Uint8ArrayList;
}

describe('@libp2p/utils AbstractMessageStream drain-microtask uncaughtException', () => {
    let originalListeners: NodeJS.UncaughtExceptionListener[] = [];

    beforeEach(() => {
        // Vitest installs its own uncaughtException handler. We temporarily
        // strip them so we can observe Node's raw delivery to our test handler
        // and so the bug doesn't crash the worker between tests.
        originalListeners = process.listeners('uncaughtException');
        for (const l of originalListeners) {
            process.removeListener('uncaughtException', l);
        }
    });

    afterEach(() => {
        for (const l of originalListeners) {
            process.on('uncaughtException', l);
        }
    });

    it('REGRESSION: a sendData throw from the drain microtask must NOT escape as uncaughtException', async () => {
        const stream = new TestStream(makeInit());

        // 1. Healthy send first, buffer drains.
        stream.send(new Uint8Array(16));
        expect(stream.writeBufferLength).toBe(0);

        // 2. Reproduce the post-drain state: bytes queued in writeBuffer (yamux
        //    had queued frames), writableNeedsDrain=true (transport had
        //    backpressured).
        const internals = stream as unknown as AbstractMessageStreamInternals;
        internals.writeBuffer.append(new Uint8Array(16));
        stream.writableNeedsDrain = true;

        // 3. The underlying transport now begins to close (race window).
        stream.throwOnSend = true;

        // 4. Capture any uncaughtException that fires from the libp2p microtask.
        const captured: unknown[] = [];
        const handler: NodeJS.UncaughtExceptionListener = (err) => {
            captured.push(err);
        };
        process.on('uncaughtException', handler);

        try {
            // 5. Fire 'drain'. AbstractMessageStream's listener schedules
            //    queueMicrotask(() => this.processSendQueue()).
            stream.dispatchEvent(new Event('drain'));

            // 6. Allow the microtask + uncaughtException dispatch to run.
            await flushMicrotasks();
        } finally {
            process.removeListener('uncaughtException', handler);
        }

        // After the fix, the throw must be handled inside the microtask (try/catch
        // around processSendQueue, or stream.abort(err), or similar). Nothing
        // should reach the process-level uncaughtException handler.
        //
        // FAILS today because the microtask body is unguarded: captured.length
        // is 1 with a StreamStateError. PASSES after the proposed fix.
        expect(captured).toHaveLength(0);
    });

    it('CONTROL: a healthy drain (sendData succeeds) does NOT emit uncaughtException', async () => {
        const stream = new TestStream(makeInit());

        stream.send(new Uint8Array(16));
        const internals = stream as unknown as AbstractMessageStreamInternals;
        internals.writeBuffer.append(new Uint8Array(16));
        stream.writableNeedsDrain = true;
        stream.throwOnSend = false; // healthy transport

        const captured: unknown[] = [];
        const handler: NodeJS.UncaughtExceptionListener = (err) => {
            captured.push(err);
        };
        process.on('uncaughtException', handler);

        try {
            stream.dispatchEvent(new Event('drain'));
            await flushMicrotasks();
        } finally {
            process.removeListener('uncaughtException', handler);
        }

        expect(captured).toHaveLength(0);
        expect(stream.writeBufferLength).toBe(0); // flushed cleanly
    });

    it('REGRESSION: user-level try/catch CAN NEVER catch the microtask throw, so the fix must live in @libp2p/utils', async () => {
        const stream = new TestStream(makeInit());

        stream.send(new Uint8Array(16));
        const internals = stream as unknown as AbstractMessageStreamInternals;
        internals.writeBuffer.append(new Uint8Array(16));
        stream.writableNeedsDrain = true;
        stream.throwOnSend = true;

        const captured: unknown[] = [];
        const handler: NodeJS.UncaughtExceptionListener = (err) => {
            captured.push(err);
        };
        process.on('uncaughtException', handler);

        let syncCaught: unknown = null;
        try {
            try {
                stream.dispatchEvent(new Event('drain'));
            } catch (err) {
                syncCaught = err;
            }

            await flushMicrotasks();
        } finally {
            process.removeListener('uncaughtException', handler);
        }

        // Documents why a downstream user can't fix this themselves: the
        // synchronous try/catch around dispatchEvent catches nothing because the
        // throw fires on a later microtask turn. This stays true regardless of
        // the fix.
        expect(syncCaught).toBeNull();

        // And after the fix, no throw should leak to the process level either.
        // FAILS today (captured.length is 1). PASSES after the proposed fix.
        expect(captured).toHaveLength(0);
    });
});

/**
 * Reproduces the silent-byte-loss bug in `AbstractMessageStream.processSendQueue`:
 *
 *   const toSend = this.writeBuffer.sublist(0, end)
 *   const willSend = new Uint8ArrayList(toSend)
 *   this.writeBuffer.consume(toSend.byteLength)   // ← bytes removed FIRST
 *   const sendResult = this.sendData(toSend)      // ← can throw HERE
 *   if (sendResult.sentBytes !== willSend.byteLength) {
 *     willSend.consume(sendResult.sentBytes)
 *     this.writeBuffer.prepend(willSend)          // ← recovery only on RETURN
 *   }
 *
 * The `consume` happens before `sendData`, and the `prepend` recovery only
 * runs when `sendData` *returns* a partial result. On throw, control jumps
 * to the surrounding `try { ... } finally { sendingData = false }` and the
 * recovery never executes. Bytes are silently lost from the queue.
 *
 * In production this happens together with the drain-microtask uncaught
 * throw, but the data loss happens on every throw path through
 * processSendQueue, including the catchable synchronous one from `send()`.
 * That's what these tests pin down.
 */
describe('@libp2p/utils AbstractMessageStream silent byte loss on sendData throw', () => {
    let originalListeners: NodeJS.UncaughtExceptionListener[] = [];

    beforeEach(() => {
        originalListeners = process.listeners('uncaughtException');
        for (const l of originalListeners) {
            process.removeListener('uncaughtException', l);
        }
    });

    afterEach(() => {
        for (const l of originalListeners) {
            process.on('uncaughtException', l);
        }
    });

    it('REGRESSION: when sendData throws, the bytes must not be silently dropped', () => {
        const stream = new TestStream(makeInit());
        const payload = new Uint8Array(16).fill(0xAB);

        stream.throwOnSend = true;

        // send() will: append to writeBuffer, then processSendQueue(), which
        // calls writeBuffer.consume(16), then sendData(payload), which throws.
        // The throw is catchable on the send() caller's stack.
        let caught: unknown = null;
        try {
            stream.send(payload);
        } catch (err) {
            caught = err;
        }

        expect(caught).toBeInstanceOf(Error);
        expect((caught as Error).name).toBe('StreamStateError');

        // sendData received the payload but threw, so nothing was delivered.
        expect(stream.attempted).toHaveLength(1);
        expect(stream.delivered).toHaveLength(0);

        // After the fix, the failure must be observable: either the bytes are
        // still in writeBuffer (re-prepended for later recovery, symmetric with
        // the existing partial-return path) or the stream has transitioned to a
        // non-writable state (abort/close signaled to all callers).
        //
        // FAILS today: writeBufferLength is 0 (bytes consumed before sendData
        // threw, prepend never ran) AND writeStatus is still 'writable'.
        // PASSES after a fix that either preserves the bytes or aborts the stream.
        const bytesPreserved = stream.writeBufferLength > 0;
        const streamMarkedFailed = stream.writeStatus !== 'writable';
        expect(bytesPreserved || streamMarkedFailed).toBe(true);
    });

    it('REGRESSION: partial drain (chunk1 delivered, chunk2 throws) must not silently drop chunk2', () => {
        // Force processSendQueue to split the writeBuffer into multiple
        // sendData() calls within one invocation. Arrange for the second call
        // to throw.
        const stream = new TestStream(makeInit());
        stream.maxMessageSize = 16;

        const chunk1 = new Uint8Array(16).fill(0x11);
        const chunk2 = new Uint8Array(16).fill(0x22);

        const internals = stream as unknown as AbstractMessageStreamInternals;
        internals.writeBuffer.append(chunk1);
        internals.writeBuffer.append(chunk2);

        // Wrap sendData so the second call throws.
        const originalSendData = stream.sendData.bind(stream);
        let callCount = 0;
        stream.sendData = (data: Uint8ArrayList): SendResult => {
            callCount++;
            if (callCount === 2) {
                stream.throwOnSend = true;
            }
            return originalSendData(data);
        };

        let caught: unknown = null;
        try {
            (stream as unknown as { processSendQueue: () => boolean }).processSendQueue();
        } catch (err) {
            caught = err;
        }

        expect(caught).toBeInstanceOf(Error);
        expect((caught as Error).name).toBe('StreamStateError');

        // chunk1 was sent cleanly.
        expect(stream.delivered).toHaveLength(1);
        expect(stream.delivered[0]).toEqual(chunk1);

        // chunk2 was attempted but threw.
        expect(stream.attempted).toHaveLength(2);

        // After the fix, chunk2 must not be silently dropped. Either chunk2 is
        // still in writeBuffer (re-prepended for retry) or the stream has
        // transitioned to a non-writable state.
        //
        // FAILS today: writeBufferLength is 0 (chunk2 consumed before sendData
        // threw, prepend never ran) AND writeStatus is still 'writable'. The
        // remote peer waits forever for the missing 16 bytes that vanished
        // mid-flush while the caller's send() had already returned success.
        // PASSES after a fix that either preserves the unsent bytes or aborts.
        const chunk2Preserved = stream.writeBufferLength >= 16;
        const streamMarkedFailed = stream.writeStatus !== 'writable';
        expect(chunk2Preserved || streamMarkedFailed).toBe(true);
    });

    it('COMPARISON: a partial RETURN from sendData re-prepends the unsent bytes (the recovery path that throws bypass)', () => {
        // Sanity check: when sendData *returns* `sentBytes < willSend.byteLength`,
        // the prepend recovery DOES run and bytes are preserved. This makes the
        // throw-vs-return asymmetry obvious.
        const stream = new TestStream(makeInit());

        // Override sendData to claim only half of the bytes were sent.
        stream.sendData = (data: Uint8ArrayList): SendResult => {
            const half = Math.floor(data.byteLength / 2);
            return { sentBytes: half, canSendMore: false };
        };

        const payload = new Uint8Array(16).fill(0x33);
        stream.send(payload);

        // The "unsent" half (8 bytes) was re-prepended into the writeBuffer.
        expect(stream.writeBufferLength).toBe(8);
        // And writableNeedsDrain is now true so the next drain event will flush.
        expect(stream.writableNeedsDrain).toBe(true);

        // Compare to the throw path: no recovery, bytes vanish.
    });
});
