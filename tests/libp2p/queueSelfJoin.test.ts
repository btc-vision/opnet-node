import { describe, it, expect } from 'vitest';
import { Queue } from '@libp2p/utils';

/**
 * Reproduces the @libp2p/utils Queue self-recipient cycle that crashed our P2P worker.
 *
 * Real-world chain:
 *   dial(peerX, {onProgress: ext})
 *     → Job_X = queue.add(dialFn, {onProgress: ext})
 *     → Job_X.run() builds inner_X = (evt) => recipients.forEach(r => r.onProgress?.(evt))
 *     → dialFn({...opts, onProgress: inner_X})
 *       → calculateMultiaddrs → peerRouting.findPeer(peerX, {onProgress: inner_X})
 *         → kad-dht queryManager → query-path → query()
 *           → network.sendRequest(peerX, FIND_NODE, {onProgress: inner_X})
 *             → openStream(peerX) → openConnection(peerX)
 *               → dialQueue.dial(peerX, {onProgress: inner_X})
 *                 → existingDial = Job_X (same job!)
 *                 → existingDial.join({onProgress: inner_X})
 *                   → Job_X.recipients.push({onProgress: inner_X})
 *
 * Now Job_X.recipients contains a recipient whose onProgress IS Job_X's own
 * fan-out closure. The next time inner_X fires, it iterates recipients, calls
 * inner_X again, iterates again, ... → RangeError: Maximum call stack size.
 *
 * This test reduces the chain to its essence: a job that joins itself with
 * its own inner onProgress, then fires a progress event.
 */
describe('@libp2p/utils Queue self-recipient cycle', () => {
    it('infinite-recurses when a job is self-joined with its own inner onProgress', async () => {
        const queue = new Queue<void, { onProgress?: (evt: Event) => void }>();

        let observedError: unknown;
        try {
            await queue.add(
                (opts) => {
                    // While running, a Job stays at the head of queue.queue (see
                    // @libp2p/utils/dist/src/queue/index.js:78-83). This is the same
                    // mechanism dialQueue.dial uses to find an "existingDial".
                    const runningJob = (queue as unknown as { queue: Array<{ join: (o: unknown) => Promise<void> }> }).queue[0];

                    // Replicate dial-queue.js:123 — `existingDial.join(options)`
                    // where options.onProgress is the running job's own inner_X
                    // (here: opts.onProgress, which Job.run set to inner_X before
                    // invoking us).
                    void runningJob.join({ onProgress: opts.onProgress });

                    // Fire any progress event. Without the fix this self-recurses
                    // through inner_X → recipients.forEach → inner_X → ...
                    opts.onProgress?.(new Event('repro'));
                },
                { onProgress: () => {} },
            );
        } catch (err) {
            observedError = err;
        }

        // BEFORE FIX: Job.run catches the synchronous RangeError thrown out of fn
        // and rejects the joiner's deferred with it.
        // AFTER FIX: no recursion — queue.add resolves cleanly.
        expect(observedError).toBeUndefined();
    });

    it('still fans progress events out to all distinct external recipients', async () => {
        const queue = new Queue<void, { onProgress?: (evt: Event) => void }>();
        const seenA: string[] = [];
        const seenB: string[] = [];

        let resolveSecondJoined: () => void = () => {};
        const secondJoined = new Promise<void>((resolve) => {
            resolveSecondJoined = resolve;
        });

        const first = queue.add(
            async (opts) => {
                // Wait until the second caller has joined this same job, then
                // fire one progress event — both recipients must observe it.
                await secondJoined;
                opts.onProgress?.(new Event('hello'));
            },
            {
                onProgress: (evt) => {
                    seenA.push(evt.type);
                },
            },
        );

        const runningJob = (
            queue as unknown as { queue: Array<{ join: (o: unknown) => Promise<void> }> }
        ).queue[0];

        const second = runningJob.join({
            onProgress: (evt: Event) => {
                seenB.push(evt.type);
            },
        });

        resolveSecondJoined();
        await Promise.all([first, second]);

        expect(seenA).toEqual(['hello']);
        expect(seenB).toEqual(['hello']);
    });
});
