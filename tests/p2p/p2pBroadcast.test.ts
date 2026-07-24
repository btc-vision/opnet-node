import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPNetBroadcastData } from '../../src/src/threading/interfaces/thread-messages/messages/api/BroadcastTransactionOPNet.js';
import { P2PManager } from '../../src/src/poc/networking/P2PManager.js';
import { ITransactionPacket } from '../../src/src/poc/networking/protobuf/packets/blockchain/common/TransactionPacket.js';
import { FastStringMap } from '../../src/src/utils/fast/FastStringMap.js';
import { FastStringSet } from '../../src/src/utils/fast/FastStringSet.js';

vi.mock('../../src/src/config/Config.js', () => ({
    Config: {
        DEV_MODE: false,
        DEBUG_LEVEL: 0,
        DEV: {
            SAVE_TIMEOUTS_TO_FILE: false,
        },
        P2P: {
            ENABLE_P2P_LOGGING: false,
        },
        OP_NET: {
            MODE: 'ARCHIVE',
        },
    },
}));

vi.mock('../../src/src/poc/networking/server/protocol/OPNetProtocolV1.js', () => ({
    OPNetProtocolV1: class OPNetProtocolV1 {},
}));

type FakePeer = {
    readonly isAuthenticated: boolean;
    readonly broadcastMempoolTransaction: ReturnType<typeof vi.fn>;
};

type P2PTestHarness = {
    peers: FastStringMap<FakePeer>;
    knownMempoolIdentifiers: FastStringSet;
    warn: ReturnType<typeof vi.fn>;
};

function createHarness(peer: FakePeer): P2PTestHarness {
    const harness = Object.create(P2PManager.prototype) as P2PTestHarness;
    harness.peers = new FastStringMap<FakePeer>([['peer-a', peer]]);
    harness.knownMempoolIdentifiers = new FastStringSet();
    harness.warn = vi.fn();
    return harness;
}

describe('P2PManager mempool broadcast RPC path', () => {
    afterEach(async () => {
        await vi.runOnlyPendingTimersAsync();
        vi.useRealTimers();
    });

    it('returns the attempted peer count without waiting for peer writes to settle', async () => {
        vi.useFakeTimers();

        const peer: FakePeer = {
            isAuthenticated: true,
            broadcastMempoolTransaction: vi.fn(() => new Promise<void>(() => {})),
        };
        const harness = createHarness(peer);

        const result = P2PManager.prototype.broadcastTransaction.call(
            harness as unknown as P2PManager,
            {
                raw: Uint8Array.from([1, 2, 3]),
                psbt: false,
                id: 'txid-a',
            },
        );

        expect(result).toEqual({ peers: 1 });
        expect(peer.broadcastMempoolTransaction).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(8_000);
    });

    it('normalizes indexed-object raw bytes before queuing peer broadcasts', async () => {
        vi.useFakeTimers();

        let sentPacket: ITransactionPacket | undefined;
        const peer: FakePeer = {
            isAuthenticated: true,
            broadcastMempoolTransaction: vi.fn((packet: ITransactionPacket) => {
                sentPacket = packet;
                return Promise.resolve();
            }),
        };
        const harness = createHarness(peer);

        const indexedRaw = { 0: 9, 1: 8, 2: 7 } as unknown as Uint8Array;
        const data: OPNetBroadcastData = {
            raw: indexedRaw,
            psbt: false,
            id: 'txid-b',
        };

        const result = P2PManager.prototype.broadcastTransaction.call(
            harness as unknown as P2PManager,
            data,
        );

        expect(result).toEqual({ peers: 1 });
        expect(sentPacket?.transaction).toBeInstanceOf(Uint8Array);
        expect([...((sentPacket?.transaction as Uint8Array | undefined) ?? [])]).toEqual([
            9, 8, 7,
        ]);

        await vi.advanceTimersByTimeAsync(8_000);
    });
});
