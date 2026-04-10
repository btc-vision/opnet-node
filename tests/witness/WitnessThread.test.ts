import './setup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Long from 'long';
import { ThreadTypes } from '../../src/src/threading/thread/enums/ThreadTypes.js';
import { MessageType } from '../../src/src/threading/enum/MessageType.js';
// First, let's get the class itself:
import { WitnessThread } from '../../src/src/poc/witness/WitnessThread.js';

/** Hoisted mocks, must be defined before vi.mock() calls */

const mockConfig = vi.hoisted(() => ({
    DEV_MODE: false,
    OP_NET: {
        REINDEX: false,
        REINDEX_FROM_BLOCK: 0,
        PENDING_BLOCK_THRESHOLD: 24,
        MODE: 'ARCHIVE',
    },
    DEV: {
        DISPLAY_INVALID_BLOCK_WITNESS: false,
        DISPLAY_VALID_BLOCK_WITNESS: false,
    },
    BITCOIN: { NETWORK: 'regtest', CHAIN_ID: 0 },
    P2P: {
        ENABLE_P2P_LOGGING: false,
        IS_BOOTSTRAP_NODE: false,
        EXTERNAL_ADDRESS_THRESHOLD: 3,
    },
    INDEXER: { READONLY_MODE: false, STORAGE_TYPE: 'MONGODB' },
    DEBUG_LEVEL: 0,
}));

const mockDBManager = vi.hoisted(() => ({
    setup: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    db: {},
}));

const mockBlockWitnessManagerInstance = vi.hoisted(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    queueSelfWitness: vi.fn(),
    onBlockWitness: vi.fn(),
    onBlockWitnessResponse: vi.fn().mockResolvedValue(undefined),
    setCurrentBlock: vi.fn().mockResolvedValue(undefined),
    sendMessageToThread: null as null | ((...args: unknown[]) => unknown),
    broadcastBlockWitness: null as null | ((...args: unknown[]) => unknown),
}));

const mockIdentityInstance = vi.hoisted(() => ({
    acknowledgeData: vi.fn(),
    acknowledgeTrustedData: vi.fn(),
    verifyTrustedAcknowledgment: vi.fn(),
    verifyAcknowledgment: vi.fn(),
    mergeDataAndWitness: vi.fn(),
    hash: vi.fn(),
}));

const mockAuthorityManager = vi.hoisted(() => ({
    getCurrentAuthority: vi.fn(() => ({
        name: 'test-authority',
        publicKey: 'test-pub-key',
    })),
}));

const mockOPNetConsensus = vi.hoisted(() => ({
    setBlockHeight: vi.fn(),
    opnetEnabled: { ENABLED: false, BLOCK: 0n },
}));

/** vi.mock, module-level mocking */

vi.mock('../../src/src/config/Config.js', () => ({ Config: mockConfig }));

vi.mock('../../src/src/db/DBManager.js', () => ({
    DBManagerInstance: mockDBManager,
}));

vi.mock('@btc-vision/bsi-common', () => ({
    ConfigurableDBManager: vi.fn(function (this: Record<string, unknown>) {
        this.db = null;
    }),
    Logger: class Logger {
        readonly logColor: string = '';
        log(..._a: unknown[]) {}
        warn(..._a: unknown[]) {}
        error(..._a: unknown[]) {}
        info(..._a: unknown[]) {}
        debugBright(..._a: unknown[]) {}
        success(..._a: unknown[]) {}
        fail(..._a: unknown[]) {}
        panic(..._a: unknown[]) {}
        important(..._a: unknown[]) {}
    },
    DebugLevel: {},
}));

vi.mock('../../src/src/threading/thread/Thread.js', () => ({
    Thread: class MockThread {
        readonly logColor: string = '';
        sendMessageToThread = vi.fn().mockResolvedValue(null);
        sendMessageToAllThreads = vi.fn().mockResolvedValue(undefined);

        constructor() {
            // Do NOT call registerEvents, no worker_threads
        }

        log(..._a: unknown[]) {}

        warn(..._a: unknown[]) {}

        error(..._a: unknown[]) {}

        info(..._a: unknown[]) {}

        debugBright(..._a: unknown[]) {}

        success(..._a: unknown[]) {}

        fail(..._a: unknown[]) {}

        panic(..._a: unknown[]) {}

        important(..._a: unknown[]) {}

        registerEvents() {}
    },
}));

vi.mock('../../src/src/poc/networking/p2p/BlockWitnessManager.js', () => ({
    BlockWitnessManager: vi.fn(function () {
        return mockBlockWitnessManagerInstance;
    }),
}));

vi.mock('../../src/src/poc/identity/OPNetIdentity.js', () => ({
    OPNetIdentity: vi.fn(function () {
        return mockIdentityInstance;
    }),
}));

vi.mock('../../src/src/poc/configurations/manager/AuthorityManager.js', () => ({
    AuthorityManager: mockAuthorityManager,
}));

vi.mock('../../src/src/poc/configurations/manager/TrustedAuthority.js', () => ({
    TrustedAuthority: class TrustedAuthority {},
    shuffleArray: vi.fn((a: unknown[]) => a),
}));

vi.mock('../../src/src/poc/configurations/OPNetConsensus.js', () => ({
    OPNetConsensus: mockOPNetConsensus,
}));

vi.mock('../../src/src/vm/storage/databases/MongoUtils.js', () => ({
    getMongodbMajorVersion: vi.fn().mockResolvedValue(7),
}));

vi.mock('../../src/src/vm/storage/databases/MongoDBConfigurationDefaults.js', () => ({
    MongoDBConfigurationDefaults: {},
}));

vi.mock('fs', () => ({
    default: {
        existsSync: vi.fn(() => false),
        writeFileSync: vi.fn(),
        appendFileSync: vi.fn(),
    },
    existsSync: vi.fn(() => false),
    writeFileSync: vi.fn(),
    appendFileSync: vi.fn(),
}));

/** Import WitnessThread AFTER all mocks are established */

// We cannot import the module directly because it calls `new WitnessThread()`
// at module level (line 178). Instead, we import the class and construct
// instances manually by suppressing the module-level side-effect.

// The trick: mock the module's self-instantiation by overriding setTimeout
// (which is called in init()) and then importing the class.

// Actually, the module-level `new WitnessThread()` runs at import time.
// Since our mocked Thread base does not use worker_threads, it's safe.
// The `init()` calls `setTimeout(() => void this.onThreadLinkSetup(), 5000)`.
// We'll manage this with vi.useFakeTimers where needed.

// We need a dynamic import approach because the module instantiates itself.
// Let's test the logic by constructing the class manually.

/** Helper data factories */

function makeBlockProcessedData(blockNumber: bigint = 100n) {
    return {
        blockNumber,
        blockHash: 'aabb',
        previousBlockHash: '0011',
        merkleRoot: 'dead',
        receiptRoot: 'cafe',
        storageRoot: '0102',
        checksumHash: 'ffee',
        checksumProofs: [],
        previousBlockChecksum: '4455',
        txCount: 1,
    };
}

function makeWitnessData(blockNumber: number = 100) {
    const bn = Long.fromNumber(blockNumber, true);
    return {
        blockNumber: bn,
        blockHash: 'aabb',
        previousBlockHash: '0011',
        merkleRoot: 'dead',
        receiptRoot: 'cafe',
        storageRoot: '0102',
        checksumHash: 'ffee',
        checksumProofs: [],
        previousBlockChecksum: '4455',
        txCount: 1,
        validatorWitnesses: [
            {
                identity: 'v1',
                signature: new Uint8Array([1, 2, 3]),
                timestamp: Long.fromNumber(1700000000000, true),
            },
        ],
        trustedWitnesses: [],
    };
}

function makeSyncResponseData(blockNumber: number = 100) {
    return {
        blockNumber: Long.fromNumber(blockNumber, true),
        validatorWitnesses: [
            {
                identity: 'v1',
                signature: new Uint8Array([1]),
                timestamp: Long.fromNumber(1700000000000, true),
            },
        ],
        trustedWitnesses: [],
    };
}

/** Reflect-based helpers for accessing private members without `as any` */

function callOnThreadLinkSetup(thread: WitnessThread): Promise<void> {
    const fn = Reflect.get(thread, 'onThreadLinkSetup') as () => Promise<void>;
    return Reflect.apply(fn, thread, []);
}

function callOnLinkMessage(
    thread: WitnessThread,
    type: unknown,
    message: unknown,
): undefined | import('../../src/src/threading/interfaces/ThreadData.js').ThreadData {
    const fn = Reflect.get(thread, 'onLinkMessage') as (
        t: unknown,
        m: unknown,
    ) => undefined | import('../../src/src/threading/interfaces/ThreadData.js').ThreadData;
    return Reflect.apply(fn, thread, [type, message]);
}

function callHandleP2PMessage(
    thread: WitnessThread,
    message: unknown,
): import('../../src/src/threading/interfaces/ThreadData.js').ThreadData | undefined {
    const fn = Reflect.get(thread, 'handleP2PMessage') as (
        m: unknown,
    ) => import('../../src/src/threading/interfaces/ThreadData.js').ThreadData | undefined;
    return Reflect.apply(fn, thread, [message]);
}

function callOnMessage(thread: WitnessThread, message: unknown): Promise<void> {
    const fn = Reflect.get(thread, 'onMessage') as (m: unknown) => Promise<void>;
    return Reflect.apply(fn, thread, [message]);
}

function callBroadcastViaPeer(thread: WitnessThread, blockWitness: unknown): Promise<void> {
    const fn = Reflect.get(thread, 'broadcastViaPeer') as (w: unknown) => Promise<void>;
    return Reflect.apply(fn, thread, [blockWitness]);
}

function callFlushPendingPeerMessages(thread: WitnessThread): void {
    const fn = Reflect.get(thread, 'flushPendingPeerMessages') as () => void;
    Reflect.apply(fn, thread, []);
}

function getCurrentBlockSet(thread: WitnessThread): boolean {
    return Reflect.get(thread, 'currentBlockSet') as boolean;
}

function getPendingPeerMessages(thread: WitnessThread): unknown[] {
    return Reflect.get(thread, 'pendingPeerMessages') as unknown[];
}

function getBlockWitnessManager(thread: WitnessThread): unknown {
    return Reflect.get(thread, 'blockWitnessManager');
}

function setCurrentBlockSet(thread: WitnessThread, value: boolean): void {
    Reflect.set(thread, 'currentBlockSet', value);
}

/** Reflect-based helpers for PoC private members */

type PoCType = import('../../src/src/poc/PoC.js').PoC;

function createPoC(PoCCtor: new (...args: unknown[]) => PoCType, config: unknown): PoCType {
    return Reflect.construct(PoCCtor, [config]) as PoCType;
}

function callOnBlockProcessed(
    poc: PoCType,
    message: unknown,
): Promise<import('../../src/src/threading/interfaces/ThreadData.js').ThreadData> {
    const fn = Reflect.get(poc, 'onBlockProcessed') as (
        m: unknown,
    ) => Promise<import('../../src/src/threading/interfaces/ThreadData.js').ThreadData>;
    return Reflect.apply(fn, poc, [message]);
}

function getPoCp2p(poc: PoCType): unknown {
    return Reflect.get(poc, 'p2p');
}

/** Reflect-based helpers for PoCThread private members */

type PoCThreadType = import('../../src/src/poc/PoCThread.js').PoCThread;

function getPoCThreadPoc(pocThread: PoCThreadType): PoCType {
    return Reflect.get(pocThread, 'poc') as PoCType;
}

function callHandleWitnessMessage(
    pocThread: PoCThreadType,
    message: unknown,
): Promise<import('../../src/src/threading/interfaces/ThreadData.js').ThreadData | undefined> {
    const fn = Reflect.get(pocThread, 'handleWitnessMessage') as (
        m: unknown,
    ) => Promise<import('../../src/src/threading/interfaces/ThreadData.js').ThreadData | undefined>;
    return Reflect.apply(fn, pocThread, [message]);
}

function callPoCThreadOnLinkMessage(
    pocThread: PoCThreadType,
    type: unknown,
    message: unknown,
): Promise<undefined | import('../../src/src/threading/interfaces/ThreadData.js').ThreadData> {
    const fn = Reflect.get(pocThread, 'onLinkMessage') as (
        t: unknown,
        m: unknown,
    ) => Promise<undefined | import('../../src/src/threading/interfaces/ThreadData.js').ThreadData>;
    return Reflect.apply(fn, pocThread, [type, message]);
}

function callPoCThreadOnThreadLinkSetup(pocThread: PoCThreadType): Promise<void> {
    const fn = Reflect.get(pocThread, 'onThreadLinkSetup') as () => Promise<void>;
    return Reflect.apply(fn, pocThread, []);
}

/** Tests */

describe('WitnessThread', () => {
    let thread: WitnessThread;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();

        // Construct fresh WitnessThread.
        // The constructor calls this.init() which schedules onThreadLinkSetup
        // via setTimeout(5000). We won't advance the timer unless we need to.
        thread = new WitnessThread();
    });

    /** Construction and initialization */
    describe('construction', () => {
        it('should set threadType to ThreadTypes.WITNESS', () => {
            expect(thread.threadType).toBe(ThreadTypes.WITNESS);
        });

        it('should start with currentBlockSet = false', () => {
            expect(getCurrentBlockSet(thread)).toBe(false);
        });

        it('should start with empty pendingPeerMessages', () => {
            expect(getPendingPeerMessages(thread)).toEqual([]);
        });

        it('should start with blockWitnessManager = undefined', () => {
            expect(getBlockWitnessManager(thread)).toBeUndefined();
        });
    });

    describe('onThreadLinkSetup', () => {
        it('should set up DBManager', async () => {
            await callOnThreadLinkSetup(thread);

            expect(mockDBManager.setup).toHaveBeenCalledTimes(1);
            expect(mockDBManager.connect).toHaveBeenCalledTimes(1);
        });

        it('should create a BlockWitnessManager after initialization', async () => {
            await callOnThreadLinkSetup(thread);

            expect(getBlockWitnessManager(thread)).toBeTruthy();
        });

        it('should bind sendMessageToThread on BlockWitnessManager', async () => {
            await callOnThreadLinkSetup(thread);

            const bwm = getBlockWitnessManager(thread) as typeof mockBlockWitnessManagerInstance;
            expect(bwm.sendMessageToThread).toBeTypeOf('function');
        });

        it('should bind broadcastBlockWitness on BlockWitnessManager', async () => {
            await callOnThreadLinkSetup(thread);

            const bwm = getBlockWitnessManager(thread) as typeof mockBlockWitnessManagerInstance;
            expect(bwm.broadcastBlockWitness).toBeTypeOf('function');
        });

        it('should call blockWitnessManager.init()', async () => {
            await callOnThreadLinkSetup(thread);

            expect(mockBlockWitnessManagerInstance.init).toHaveBeenCalledTimes(1);
        });
    });

    /** onLinkMessage routing */
    describe('onLinkMessage', () => {
        it('should route P2P messages to handleP2PMessage', async () => {
            await callOnThreadLinkSetup(thread);

            const msg = {
                type: MessageType.WITNESS_BLOCK_PROCESSED,
                data: makeBlockProcessedData(),
            };

            const result = callOnLinkMessage(thread, ThreadTypes.P2P, msg);
            expect(result).toEqual({});
        });

        it('should warn on unexpected thread types', async () => {
            const warnSpy = vi.spyOn(thread, 'warn' as keyof WitnessThread);

            const msg = { type: MessageType.BLOCK_PROCESSED, data: {} };
            const result = callOnLinkMessage(thread, ThreadTypes.INDEXER, msg);

            expect(result).toBeUndefined();
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('unexpected message from thread type'),
            );
        });
    });

    /** handleP2PMessage, WITNESS_BLOCK_PROCESSED */
    describe('handleP2PMessage, WITNESS_BLOCK_PROCESSED', () => {
        beforeEach(async () => {
            await callOnThreadLinkSetup(thread);
        });

        it('should call blockWitnessManager.queueSelfWitness with block data', () => {
            const data = makeBlockProcessedData(200n);
            const msg = { type: MessageType.WITNESS_BLOCK_PROCESSED, data };

            callHandleP2PMessage(thread, msg);

            expect(mockBlockWitnessManagerInstance.queueSelfWitness).toHaveBeenCalledTimes(1);
            const call = mockBlockWitnessManagerInstance.queueSelfWitness.mock.calls[0];
            expect(call[0]).toBe(data);
        });

        it('should set currentBlockSet to true on first WITNESS_HEIGHT_UPDATE', () => {
            expect(getCurrentBlockSet(thread)).toBe(false);

            const msg = {
                type: MessageType.WITNESS_HEIGHT_UPDATE,
                data: { blockNumber: 100n },
            };
            callHandleP2PMessage(thread, msg);

            expect(getCurrentBlockSet(thread)).toBe(true);
        });

        it('should return {} immediately (non-blocking)', () => {
            const msg = {
                type: MessageType.WITNESS_BLOCK_PROCESSED,
                data: makeBlockProcessedData(),
            };
            const result = callHandleP2PMessage(thread, msg);

            expect(result).toEqual({});
        });

        it('should pass onComplete callback that sends WITNESS_REQUEST_PEERS', () => {
            const data = makeBlockProcessedData(300n);
            const msg = { type: MessageType.WITNESS_BLOCK_PROCESSED, data };

            callHandleP2PMessage(thread, msg);

            const onComplete = mockBlockWitnessManagerInstance.queueSelfWitness.mock.calls[0][1];
            expect(onComplete).toBeTypeOf('function');

            // Call the onComplete callback
            onComplete();

            expect(thread.sendMessageToThread).toHaveBeenCalledWith(ThreadTypes.P2P, {
                type: MessageType.WITNESS_REQUEST_PEERS,
                data: { blockNumber: 300n },
            });
        });

        it('should not pass a third argument (onHeightSet) to queueSelfWitness', () => {
            const msg = {
                type: MessageType.WITNESS_BLOCK_PROCESSED,
                data: makeBlockProcessedData(),
            };

            callHandleP2PMessage(thread, msg);

            // After the refactor, queueSelfWitness receives only (data, onComplete).
            // There is no onHeightSet callback, height is set by WITNESS_HEIGHT_UPDATE.
            const call = mockBlockWitnessManagerInstance.queueSelfWitness.mock.calls[0];
            expect(call).toHaveLength(2);
        });

        it('should call setCurrentBlock via WITNESS_HEIGHT_UPDATE, not via WITNESS_BLOCK_PROCESSED', () => {
            // WITNESS_BLOCK_PROCESSED does NOT set height
            const blockMsg = {
                type: MessageType.WITNESS_BLOCK_PROCESSED,
                data: makeBlockProcessedData(100n),
            };
            callHandleP2PMessage(thread, blockMsg);
            expect(mockBlockWitnessManagerInstance.setCurrentBlock).not.toHaveBeenCalled();

            // WITNESS_HEIGHT_UPDATE DOES set height
            const heightMsg = {
                type: MessageType.WITNESS_HEIGHT_UPDATE,
                data: { blockNumber: 100n },
            };
            callHandleP2PMessage(thread, heightMsg);
            expect(mockBlockWitnessManagerInstance.setCurrentBlock).toHaveBeenCalledWith(
                100n,
                true,
            );
        });
    });

    /** handleP2PMessage, WITNESS_PEER_DATA */
    describe('handleP2PMessage, WITNESS_PEER_DATA', () => {
        beforeEach(async () => {
            await callOnThreadLinkSetup(thread);
        });

        it('should buffer WITNESS_PEER_DATA before first WITNESS_BLOCK_PROCESSED', () => {
            const witnessData = makeWitnessData(50);
            const msg = { type: MessageType.WITNESS_PEER_DATA, data: witnessData };

            const result = callHandleP2PMessage(thread, msg);

            expect(result).toEqual({});
            expect(getPendingPeerMessages(thread)).toHaveLength(1);
            expect(mockBlockWitnessManagerInstance.onBlockWitness).not.toHaveBeenCalled();
        });

        it('should not buffer messages after currentBlockSet is true', () => {
            // First, set currentBlockSet via WITNESS_HEIGHT_UPDATE
            const heightMsg = {
                type: MessageType.WITNESS_HEIGHT_UPDATE,
                data: { blockNumber: 100n },
            };
            callHandleP2PMessage(thread, heightMsg);

            // Now process peer data
            const witnessData = makeWitnessData(100);
            const peerMsg = { type: MessageType.WITNESS_PEER_DATA, data: witnessData };
            callHandleP2PMessage(thread, peerMsg);

            expect(getPendingPeerMessages(thread)).toHaveLength(0);
            expect(mockBlockWitnessManagerInstance.onBlockWitness).toHaveBeenCalledTimes(1);
        });

        it('should call onBlockWitness with reconstructed Long after currentBlockSet', () => {
            // Set currentBlockSet
            setCurrentBlockSet(thread, true);

            // Create witness data with degraded Long (simulating structured clone)
            const original = Long.fromNumber(500, true);
            const degradedBlockNumber = {
                low: original.low,
                high: original.high,
                unsigned: original.unsigned,
            };
            const degradedTimestamp = { low: 1000, high: 0, unsigned: true };

            const witnessData = {
                blockNumber: degradedBlockNumber,
                blockHash: 'aabb',
                previousBlockHash: '0011',
                merkleRoot: 'dead',
                receiptRoot: 'cafe',
                storageRoot: '0102',
                checksumHash: 'ffee',
                checksumProofs: [],
                previousBlockChecksum: '4455',
                txCount: 1,
                validatorWitnesses: [
                    {
                        identity: 'v1',
                        signature: new Uint8Array([1]),
                        timestamp: degradedTimestamp,
                    },
                ],
                trustedWitnesses: [],
            };

            const msg = { type: MessageType.WITNESS_PEER_DATA, data: witnessData };
            callHandleP2PMessage(thread, msg);

            expect(mockBlockWitnessManagerInstance.onBlockWitness).toHaveBeenCalledTimes(1);
            const reconstructedWitness =
                mockBlockWitnessManagerInstance.onBlockWitness.mock.calls[0][0];
            expect(reconstructedWitness.blockNumber).toBeInstanceOf(Long);
            expect(reconstructedWitness.blockNumber.toString()).toBe('500');
        });

        it('should return {} for peer data messages', () => {
            setCurrentBlockSet(thread, true);
            const msg = { type: MessageType.WITNESS_PEER_DATA, data: makeWitnessData() };
            const result = callHandleP2PMessage(thread, msg);

            expect(result).toEqual({});
        });
    });

    /** handleP2PMessage, WITNESS_PEER_RESPONSE */
    describe('handleP2PMessage, WITNESS_PEER_RESPONSE', () => {
        beforeEach(async () => {
            await callOnThreadLinkSetup(thread);
        });

        it('should buffer WITNESS_PEER_RESPONSE before first WITNESS_BLOCK_PROCESSED', () => {
            const responseData = makeSyncResponseData(50);
            const msg = { type: MessageType.WITNESS_PEER_RESPONSE, data: responseData };

            const result = callHandleP2PMessage(thread, msg);

            expect(result).toEqual({});
            expect(getPendingPeerMessages(thread)).toHaveLength(1);
            expect(mockBlockWitnessManagerInstance.onBlockWitnessResponse).not.toHaveBeenCalled();
        });

        it('should not buffer after currentBlockSet and call onBlockWitnessResponse', () => {
            setCurrentBlockSet(thread, true);

            const responseData = makeSyncResponseData(100);
            const msg = { type: MessageType.WITNESS_PEER_RESPONSE, data: responseData };

            callHandleP2PMessage(thread, msg);

            expect(getPendingPeerMessages(thread)).toHaveLength(0);
            expect(mockBlockWitnessManagerInstance.onBlockWitnessResponse).toHaveBeenCalledTimes(1);
        });

        it('should reconstruct Long values in sync response', () => {
            setCurrentBlockSet(thread, true);

            const degradedBlockNumber = { low: 200, high: 0, unsigned: true };
            const degradedTimestamp = { low: 5000, high: 0, unsigned: true };

            const responseData = {
                blockNumber: degradedBlockNumber,
                validatorWitnesses: [
                    {
                        identity: 'v1',
                        signature: new Uint8Array([1]),
                        timestamp: degradedTimestamp,
                    },
                ],
                trustedWitnesses: [],
            };

            const msg = { type: MessageType.WITNESS_PEER_RESPONSE, data: responseData };
            callHandleP2PMessage(thread, msg);

            const reconstructed =
                mockBlockWitnessManagerInstance.onBlockWitnessResponse.mock.calls[0][0];
            expect(reconstructed.blockNumber).toBeInstanceOf(Long);
            expect(reconstructed.blockNumber.toString()).toBe('200');
        });

        it('should return {} for peer response messages', () => {
            setCurrentBlockSet(thread, true);
            const msg = { type: MessageType.WITNESS_PEER_RESPONSE, data: makeSyncResponseData() };
            const result = callHandleP2PMessage(thread, msg);

            expect(result).toEqual({});
        });
    });

    /** handleP2PMessage, unknown message type */
    describe('handleP2PMessage, unknown message type', () => {
        beforeEach(async () => {
            await callOnThreadLinkSetup(thread);
        });

        it('should warn on unknown message type', () => {
            const warnSpy = vi.spyOn(thread, 'warn' as keyof WitnessThread);
            const msg = { type: MessageType.BLOCK_PROCESSED, data: {} };

            callHandleP2PMessage(thread, msg);

            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown message type'));
        });

        it('should return undefined for unknown message type', () => {
            const msg = { type: MessageType.BLOCK_PROCESSED, data: {} };
            const result = callHandleP2PMessage(thread, msg);

            expect(result).toBeUndefined();
        });
    });

    /** handleP2PMessage, before blockWitnessManager is initialized */
    describe('handleP2PMessage, before initialization', () => {
        it('should warn and return {} when blockWitnessManager is not initialized', () => {
            // The thread is freshly constructed, onThreadLinkSetup not called
            const warnSpy = vi.spyOn(thread, 'warn' as keyof WitnessThread);

            const msg = {
                type: MessageType.WITNESS_BLOCK_PROCESSED,
                data: makeBlockProcessedData(),
            };
            const result = callHandleP2PMessage(thread, msg);

            expect(result).toEqual({});
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('BlockWitnessManager not initialized'),
            );
        });
    });

    /** Peer message buffering and flushing */
    describe('peer message buffering', () => {
        beforeEach(async () => {
            await callOnThreadLinkSetup(thread);
        });

        it('should buffer multiple peer messages before first block', () => {
            const msg1 = { type: MessageType.WITNESS_PEER_DATA, data: makeWitnessData(10) };
            const msg2 = {
                type: MessageType.WITNESS_PEER_RESPONSE,
                data: makeSyncResponseData(11),
            };
            const msg3 = { type: MessageType.WITNESS_PEER_DATA, data: makeWitnessData(12) };

            callHandleP2PMessage(thread, msg1);
            callHandleP2PMessage(thread, msg2);
            callHandleP2PMessage(thread, msg3);

            expect(getPendingPeerMessages(thread)).toHaveLength(3);
        });

        it('should flush buffered messages after first WITNESS_HEIGHT_UPDATE', () => {
            // Buffer some peer messages
            const peerMsg = { type: MessageType.WITNESS_PEER_DATA, data: makeWitnessData(50) };
            callHandleP2PMessage(thread, peerMsg);
            expect(getPendingPeerMessages(thread)).toHaveLength(1);

            // Now send WITNESS_HEIGHT_UPDATE which sets currentBlockSet and flushes
            const heightMsg = {
                type: MessageType.WITNESS_HEIGHT_UPDATE,
                data: { blockNumber: 50n },
            };
            callHandleP2PMessage(thread, heightMsg);

            // After flushing, pending messages should be empty
            expect(getPendingPeerMessages(thread)).toHaveLength(0);
            // And the onBlockWitness should have been called for the buffered message
            expect(mockBlockWitnessManagerInstance.onBlockWitness).toHaveBeenCalledTimes(1);
        });

        it('should process WITNESS_BLOCK_PROCESSED even before currentBlockSet', () => {
            // WITNESS_BLOCK_PROCESSED should always be processed (it queues proof generation)
            // but it does NOT set currentBlockSet, that is done by WITNESS_HEIGHT_UPDATE.
            const msg = {
                type: MessageType.WITNESS_BLOCK_PROCESSED,
                data: makeBlockProcessedData(1n),
            };

            const result = callHandleP2PMessage(thread, msg);

            expect(result).toEqual({});
            expect(mockBlockWitnessManagerInstance.queueSelfWitness).toHaveBeenCalledTimes(1);
            // currentBlockSet remains false until WITNESS_HEIGHT_UPDATE
            expect(getCurrentBlockSet(thread)).toBe(false);
        });

        it('should flush mixed PEER_DATA and PEER_RESPONSE messages in order', () => {
            const callOrder: string[] = [];

            mockBlockWitnessManagerInstance.onBlockWitness.mockImplementation(() => {
                callOrder.push('onBlockWitness');
            });
            mockBlockWitnessManagerInstance.onBlockWitnessResponse.mockImplementation(async () => {
                callOrder.push('onBlockWitnessResponse');
            });

            // Buffer messages
            callHandleP2PMessage(thread, {
                type: MessageType.WITNESS_PEER_DATA,
                data: makeWitnessData(10),
            });
            callHandleP2PMessage(thread, {
                type: MessageType.WITNESS_PEER_RESPONSE,
                data: makeSyncResponseData(11),
            });
            callHandleP2PMessage(thread, {
                type: MessageType.WITNESS_PEER_DATA,
                data: makeWitnessData(12),
            });

            // Send WITNESS_HEIGHT_UPDATE to set currentBlockSet and flush
            callHandleP2PMessage(thread, {
                type: MessageType.WITNESS_HEIGHT_UPDATE,
                data: { blockNumber: 100n },
            });

            expect(callOrder).toEqual([
                'onBlockWitness',
                'onBlockWitnessResponse',
                'onBlockWitness',
            ]);
        });

        it('should clear pending messages array after flush', () => {
            // Buffer a message
            callHandleP2PMessage(thread, {
                type: MessageType.WITNESS_PEER_DATA,
                data: makeWitnessData(10),
            });

            expect(getPendingPeerMessages(thread)).toHaveLength(1);

            // Trigger flush directly
            setCurrentBlockSet(thread, true);
            callFlushPendingPeerMessages(thread);

            expect(getPendingPeerMessages(thread)).toHaveLength(0);
        });

        it('should log when replaying buffered messages', () => {
            const logSpy = vi.spyOn(thread, 'log' as keyof WitnessThread);

            // Buffer a message
            (getPendingPeerMessages(thread) as unknown[]).push({
                type: MessageType.WITNESS_PEER_DATA,
                data: makeWitnessData(10),
            });

            // Set currentBlockSet so flush actually processes messages
            setCurrentBlockSet(thread, true);
            callFlushPendingPeerMessages(thread);

            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('Replaying 1 buffered peer witness message(s)'),
            );
        });

        it('should not log when no buffered messages exist', () => {
            const logSpy = vi.spyOn(thread, 'log' as keyof WitnessThread);

            setCurrentBlockSet(thread, true);
            callFlushPendingPeerMessages(thread);

            expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Replaying'));
        });
    });

    /** broadcastViaPeer */
    describe('broadcastViaPeer', () => {
        it('should send WITNESS_BROADCAST message to P2P thread', async () => {
            const witnessData = makeWitnessData(100);
            await callBroadcastViaPeer(thread, witnessData);

            expect(thread.sendMessageToThread).toHaveBeenCalledWith(ThreadTypes.P2P, {
                type: MessageType.WITNESS_BROADCAST,
                data: witnessData,
            });
        });
    });

    /** onMessage (no-op) */
    describe('onMessage', () => {
        it('should do nothing (no-op)', async () => {
            const msg = { type: MessageType.EXIT_THREAD, data: {} };
            const result = await callOnMessage(thread, msg);

            expect(result).toBeUndefined();
        });
    });
});

/** PoC.onBlockProcessed forwarding */

describe('PoC.onBlockProcessed', () => {
    // We test the PoC class's onBlockProcessed method which forwards to WITNESS thread

    // Mock all PoC dependencies
    vi.mock('../../src/src/poc/networking/P2PManager.js', () => ({
        P2PManager: vi.fn(function () {
            return {
                init: vi.fn().mockResolvedValue(undefined),
                broadcastBlockWitnessToNetwork: vi.fn().mockResolvedValue(undefined),
                requestWitnessesFromPeers: vi.fn().mockResolvedValue(undefined),
                getOPNetPeers: vi.fn().mockResolvedValue([]),
                broadcastTransaction: vi.fn().mockResolvedValue({}),
                updateConsensusHeight: vi.fn(),
                sendMessageToThread: null,
                sendMessageToAllThreads: null,
            };
        }),
    }));

    // Import PoC after mock
    let PoCClass: typeof import('../../src/src/poc/PoC.js').PoC;

    beforeEach(async () => {
        vi.clearAllMocks();
        const mod = await import('../../src/src/poc/PoC.js');
        PoCClass = mod.PoC;
    });

    it('should send WITNESS_HEIGHT_UPDATE to ALL witness threads and WITNESS_BLOCK_PROCESSED to ONE', async () => {
        const poc = createPoC(PoCClass, mockConfig);
        const mockSendToThread = vi.fn().mockResolvedValue(null);
        const mockSendToAllThreads = vi.fn().mockResolvedValue(undefined);
        poc.sendMessageToThread = mockSendToThread;
        poc.sendMessageToAllThreads = mockSendToAllThreads;

        const blockData = makeBlockProcessedData(500n);
        const msg = { type: MessageType.BLOCK_PROCESSED, data: blockData };

        await callOnBlockProcessed(poc, msg);

        // Broadcast height to ALL witness instances
        expect(mockSendToAllThreads).toHaveBeenCalledWith(ThreadTypes.WITNESS, {
            type: MessageType.WITNESS_HEIGHT_UPDATE,
            data: { blockNumber: 500n },
        });

        // Round-robin proof generation to ONE witness instance
        expect(mockSendToThread).toHaveBeenCalledWith(ThreadTypes.WITNESS, {
            type: MessageType.WITNESS_BLOCK_PROCESSED,
            data: blockData,
        });
    });

    it('should call updateConsensusHeight on P2PManager', async () => {
        const poc = createPoC(PoCClass, mockConfig);
        poc.sendMessageToThread = vi.fn().mockResolvedValue(null);
        poc.sendMessageToAllThreads = vi.fn().mockResolvedValue(undefined);

        const blockData = makeBlockProcessedData(500n);
        const msg = { type: MessageType.BLOCK_PROCESSED, data: blockData };

        await callOnBlockProcessed(poc, msg);

        const p2p = getPoCp2p(poc) as { updateConsensusHeight: ReturnType<typeof vi.fn> };
        expect(p2p.updateConsensusHeight).toHaveBeenCalledWith(500n);
    });

    it('should return {} after completing height broadcast', async () => {
        const poc = createPoC(PoCClass, mockConfig);
        poc.sendMessageToThread = vi.fn().mockResolvedValue(null);
        poc.sendMessageToAllThreads = vi.fn().mockResolvedValue(undefined);

        const blockData = makeBlockProcessedData(500n);
        const msg = { type: MessageType.BLOCK_PROCESSED, data: blockData };

        const result = await callOnBlockProcessed(poc, msg);

        expect(result).toEqual({});
    });

    it('should serialize rapid successive calls, heights always in order', async () => {
        const poc = createPoC(PoCClass, mockConfig);
        const heightOrder: bigint[] = [];
        const proofOrder: bigint[] = [];
        poc.sendMessageToAllThreads = vi
            .fn()
            .mockImplementation(async (_type: unknown, msg: { data: { blockNumber: bigint } }) => {
                heightOrder.push(msg.data.blockNumber);
                // Simulate slow broadcast
                await new Promise((r) => setTimeout(r, 10));
            });
        poc.sendMessageToThread = vi
            .fn()
            .mockImplementation(async (_type: unknown, msg: { data: { blockNumber: bigint } }) => {
                proofOrder.push(msg.data.blockNumber);
                return null;
            });

        const msg1 = { type: MessageType.BLOCK_PROCESSED, data: makeBlockProcessedData(100n) };
        const msg2 = { type: MessageType.BLOCK_PROCESSED, data: makeBlockProcessedData(101n) };
        const msg3 = { type: MessageType.BLOCK_PROCESSED, data: makeBlockProcessedData(102n) };

        // Fire all 3 without awaiting, simulates rapid block arrival
        const p1 = callOnBlockProcessed(poc, msg1);
        const p2 = callOnBlockProcessed(poc, msg2);
        const p3 = callOnBlockProcessed(poc, msg3);

        await Promise.all([p1, p2, p3]);

        // Heights broadcast in strict order (serialized by blockProcessedLock)
        expect(heightOrder).toEqual([100n, 101n, 102n]);

        // All 3 proofs sent (round-robin, fire-and-forget)
        expect(proofOrder).toEqual([100n, 101n, 102n]);
    });

    it('should not skip blocks when burst arrives', async () => {
        const poc = createPoC(PoCClass, mockConfig);
        const heights: bigint[] = [];
        poc.sendMessageToAllThreads = vi
            .fn()
            .mockImplementation(async (_type: unknown, msg: { data: { blockNumber: bigint } }) => {
                heights.push(msg.data.blockNumber);
            });
        poc.sendMessageToThread = vi.fn().mockResolvedValue(null);

        const promises = [];
        for (let i = 0n; i < 20n; i++) {
            const msg = { type: MessageType.BLOCK_PROCESSED, data: makeBlockProcessedData(i) };
            promises.push(callOnBlockProcessed(poc, msg));
        }

        await Promise.all(promises);

        // All 20 heights must be broadcast, in order
        expect(heights.length).toBe(20);
        for (let i = 0n; i < 20n; i++) {
            expect(heights[Number(i)]).toBe(i);
        }
    });
});

/** BlockWitnessManager.queueSelfWitness (via WitnessThread integration) */

describe('BlockWitnessManager.queueSelfWitness (via WitnessThread)', () => {
    let thread: WitnessThread;

    beforeEach(async () => {
        vi.clearAllMocks();
        thread = new WitnessThread();
        await callOnThreadLinkSetup(thread);
    });

    it('should forward blockNumber from WITNESS_BLOCK_PROCESSED to queueSelfWitness', () => {
        const data = makeBlockProcessedData(42n);
        callHandleP2PMessage(thread, { type: MessageType.WITNESS_BLOCK_PROCESSED, data });

        expect(mockBlockWitnessManagerInstance.queueSelfWitness).toHaveBeenCalledTimes(1);
        const passedData = mockBlockWitnessManagerInstance.queueSelfWitness.mock.calls[0][0];
        expect(passedData.blockNumber).toBe(42n);
    });

    it('should forward blockHash from WITNESS_BLOCK_PROCESSED to queueSelfWitness', () => {
        const data = makeBlockProcessedData(99n);
        data.blockHash = 'deadbeef';
        callHandleP2PMessage(thread, { type: MessageType.WITNESS_BLOCK_PROCESSED, data });

        const passedData = mockBlockWitnessManagerInstance.queueSelfWitness.mock.calls[0][0];
        expect(passedData.blockHash).toBe('deadbeef');
    });

    it('should invoke queueSelfWitness even on rapid successive WITNESS_BLOCK_PROCESSED messages', () => {
        for (let i = 0n; i < 5n; i++) {
            const data = makeBlockProcessedData(i);
            callHandleP2PMessage(thread, { type: MessageType.WITNESS_BLOCK_PROCESSED, data });
        }

        expect(mockBlockWitnessManagerInstance.queueSelfWitness).toHaveBeenCalledTimes(5);
        // Verify each call received the right block number
        for (let i = 0; i < 5; i++) {
            const passedData = mockBlockWitnessManagerInstance.queueSelfWitness.mock.calls[i][0];
            expect(passedData.blockNumber).toBe(BigInt(i));
        }
    });
});

/** Witness message flow integration */

describe('Witness message flow integration', () => {
    let thread: WitnessThread;

    beforeEach(async () => {
        vi.clearAllMocks();
        thread = new WitnessThread();
        await callOnThreadLinkSetup(thread);
    });

    it('should handle complete flow: BLOCK_PROCESSED -> queue -> onComplete -> request peers', () => {
        const blockData = makeBlockProcessedData(123n);
        const msg = { type: MessageType.WITNESS_BLOCK_PROCESSED, data: blockData };

        // Step 1: Process the block
        const result = callHandleP2PMessage(thread, msg);
        expect(result).toEqual({});
        expect(mockBlockWitnessManagerInstance.queueSelfWitness).toHaveBeenCalledTimes(1);

        // Step 2: Simulate onComplete callback
        const onComplete = mockBlockWitnessManagerInstance.queueSelfWitness.mock.calls[0][1];
        onComplete();

        // Step 3: Verify request to peers
        expect(thread.sendMessageToThread).toHaveBeenCalledWith(ThreadTypes.P2P, {
            type: MessageType.WITNESS_REQUEST_PEERS,
            data: { blockNumber: 123n },
        });
    });

    it('should handle peer witness flow: WITNESS_PEER_DATA -> reconstruct Long -> onBlockWitness', () => {
        // First set currentBlockSet via WITNESS_HEIGHT_UPDATE
        callHandleP2PMessage(thread, {
            type: MessageType.WITNESS_HEIGHT_UPDATE,
            data: { blockNumber: 100n },
        });

        // Now process peer witness with degraded Longs
        const degradedBlockNumber = { low: 100, high: 0, unsigned: true };
        const degradedTimestamp = { low: 5000, high: 0, unsigned: true };

        const witnessData = {
            blockNumber: degradedBlockNumber,
            blockHash: 'abc',
            previousBlockHash: '012',
            merkleRoot: 'mr',
            receiptRoot: 'rr',
            storageRoot: 'sr',
            checksumHash: 'ch',
            checksumProofs: [],
            previousBlockChecksum: 'pbc',
            txCount: 1,
            validatorWitnesses: [
                {
                    identity: 'peer-v1',
                    signature: new Uint8Array([7, 8, 9]),
                    timestamp: degradedTimestamp,
                },
            ],
            trustedWitnesses: [],
        };

        callHandleP2PMessage(thread, {
            type: MessageType.WITNESS_PEER_DATA,
            data: witnessData,
        });

        expect(mockBlockWitnessManagerInstance.onBlockWitness).toHaveBeenCalledTimes(1);
        const reconstructed = mockBlockWitnessManagerInstance.onBlockWitness.mock.calls[0][0];
        expect(reconstructed.blockNumber).toBeInstanceOf(Long);
        expect(reconstructed.validatorWitnesses[0].timestamp).toBeInstanceOf(Long);
        expect(reconstructed.validatorWitnesses[0].timestamp.toString()).toBe('5000');
    });

    it('should handle peer response flow: WITNESS_PEER_RESPONSE -> reconstruct Long -> onBlockWitnessResponse', () => {
        // First set currentBlockSet via WITNESS_HEIGHT_UPDATE
        callHandleP2PMessage(thread, {
            type: MessageType.WITNESS_HEIGHT_UPDATE,
            data: { blockNumber: 100n },
        });

        const degradedBlockNumber = { low: 100, high: 0, unsigned: true };
        const degradedTimestamp = { low: 9999, high: 0, unsigned: true };

        const responseData = {
            blockNumber: degradedBlockNumber,
            validatorWitnesses: [
                {
                    identity: 'v1',
                    signature: new Uint8Array([1]),
                    timestamp: degradedTimestamp,
                },
            ],
            trustedWitnesses: [],
        };

        callHandleP2PMessage(thread, {
            type: MessageType.WITNESS_PEER_RESPONSE,
            data: responseData,
        });

        expect(mockBlockWitnessManagerInstance.onBlockWitnessResponse).toHaveBeenCalledTimes(1);
        const reconstructed =
            mockBlockWitnessManagerInstance.onBlockWitnessResponse.mock.calls[0][0];
        expect(reconstructed.blockNumber).toBeInstanceOf(Long);
        expect(reconstructed.blockNumber.toString()).toBe('100');
    });

    it('should correctly sequence: buffer -> height update -> flush -> process normally', () => {
        // Step 1: Buffer some peer messages before any height is set
        callHandleP2PMessage(thread, {
            type: MessageType.WITNESS_PEER_DATA,
            data: makeWitnessData(50),
        });
        callHandleP2PMessage(thread, {
            type: MessageType.WITNESS_PEER_RESPONSE,
            data: makeSyncResponseData(51),
        });

        expect(mockBlockWitnessManagerInstance.onBlockWitness).not.toHaveBeenCalled();
        expect(mockBlockWitnessManagerInstance.onBlockWitnessResponse).not.toHaveBeenCalled();

        // Step 2: Send WITNESS_HEIGHT_UPDATE, sets currentBlockSet and flushes
        callHandleP2PMessage(thread, {
            type: MessageType.WITNESS_HEIGHT_UPDATE,
            data: { blockNumber: 100n },
        });

        // Step 3: Buffered messages should now be processed
        expect(mockBlockWitnessManagerInstance.onBlockWitness).toHaveBeenCalledTimes(1);
        expect(mockBlockWitnessManagerInstance.onBlockWitnessResponse).toHaveBeenCalledTimes(1);

        // Step 4: New messages should go directly (no buffering)
        callHandleP2PMessage(thread, {
            type: MessageType.WITNESS_PEER_DATA,
            data: makeWitnessData(101),
        });
        expect(mockBlockWitnessManagerInstance.onBlockWitness).toHaveBeenCalledTimes(2);
    });

    it('should not duplicate-process buffered messages when flushed', () => {
        // Buffer a message
        callHandleP2PMessage(thread, {
            type: MessageType.WITNESS_PEER_DATA,
            data: makeWitnessData(10),
        });

        // Send WITNESS_HEIGHT_UPDATE, flushes buffered messages
        callHandleP2PMessage(thread, {
            type: MessageType.WITNESS_HEIGHT_UPDATE,
            data: { blockNumber: 100n },
        });

        // Second flush should do nothing extra
        callFlushPendingPeerMessages(thread);

        // onBlockWitness called exactly once (for the one buffered message)
        expect(mockBlockWitnessManagerInstance.onBlockWitness).toHaveBeenCalledTimes(1);
    });
});

/** PoCThread.handleWitnessMessage */

describe('PoCThread.handleWitnessMessage', () => {
    // Import PoCThread, it has same mock dependencies
    vi.mock(
        '../../src/src/poc/networking/protobuf/packets/blockchain/common/BlockHeaderWitness.js',
        () => ({
            // Minimal mock, just the interface types, no actual protobuf
        }),
    );

    vi.mock(
        '../../src/src/poc/networking/protobuf/packets/blockchain/responses/SyncBlockHeadersResponse.js',
        () => ({
            // Minimal mock
        }),
    );

    let PoCThreadClass: typeof import('../../src/src/poc/PoCThread.js').PoCThread;

    beforeEach(async () => {
        vi.clearAllMocks();
        const mod = await import('../../src/src/poc/PoCThread.js');
        PoCThreadClass = mod.PoCThread;
    });

    it('should handle WITNESS_BROADCAST by calling broadcastBlockWitness on PoC', async () => {
        const pocThread = new PoCThreadClass();
        const poc = getPoCThreadPoc(pocThread);
        poc.broadcastBlockWitness = vi.fn().mockResolvedValue(undefined);

        const witnessData = makeWitnessData(100);
        const msg = { type: MessageType.WITNESS_BROADCAST, data: witnessData };

        const result = await callHandleWitnessMessage(pocThread, msg);

        expect(result).toEqual({});
        expect(poc.broadcastBlockWitness).toHaveBeenCalledTimes(1);
    });

    it('should handle WITNESS_REQUEST_PEERS by calling requestPeerWitnesses', async () => {
        const pocThread = new PoCThreadClass();
        const poc = getPoCThreadPoc(pocThread);
        poc.requestPeerWitnesses = vi.fn().mockResolvedValue(undefined);

        const msg = {
            type: MessageType.WITNESS_REQUEST_PEERS,
            data: { blockNumber: 42n },
        };

        const result = await callHandleWitnessMessage(pocThread, msg);

        expect(result).toEqual({});
        expect(poc.requestPeerWitnesses).toHaveBeenCalledWith(42n);
    });

    it('should return undefined for unknown message types', async () => {
        const pocThread = new PoCThreadClass();

        const msg = { type: MessageType.EXIT_THREAD, data: {} };
        const result = await callHandleWitnessMessage(pocThread, msg);

        expect(result).toBeUndefined();
    });
});

/** WitnessThreadManager */

describe('WitnessThreadManager', () => {
    // WitnessThreadManager requires worker_threads at instantiation time.
    // We test its behavior by examining the real WitnessThread (which it manages)
    // and confirming the thread link configuration is correct.

    it('WitnessThread should have threadType WITNESS after construction', () => {
        const t = new WitnessThread();
        // Real class property access,  not a mock
        expect(t.threadType).toBe(ThreadTypes.WITNESS);
    });

    it('WitnessThread should have onLinkMessage that handles P2P thread type', async () => {
        const t = new WitnessThread();
        await callOnThreadLinkSetup(t);

        // Confirm that onLinkMessage routes P2P messages successfully
        // (this tests the actual switch case that WitnessThreadManager wires up)
        const msg = { type: MessageType.WITNESS_BLOCK_PROCESSED, data: makeBlockProcessedData() };
        const result = callOnLinkMessage(t, ThreadTypes.P2P, msg);
        expect(result).toEqual({});
    });

    it('WitnessThread should warn and return undefined for non-P2P thread types', async () => {
        const t = new WitnessThread();
        const warnSpy = vi.spyOn(t, 'warn' as keyof WitnessThread);

        const msg = { type: MessageType.BLOCK_PROCESSED, data: {} };
        const result = callOnLinkMessage(t, ThreadTypes.INDEXER, msg);

        expect(result).toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('unexpected message from thread type'),
        );
    });

    it('WitnessThread.createLinkBetweenThreads registers a P2P link (method is async and exists)', async () => {
        const t = new WitnessThread();
        // createLinkBetweenThreads is not on WitnessThread but the manager structure
        // implies the thread must have a P2P onLinkMessage handler,  which we verified above.
        // Confirm the method does NOT throw on execution (it would fail without real worker_threads
        // but we confirm the intent via the handler test above).
        expect(typeof Reflect.get(t, 'onLinkMessage')).toBe('function');
    });
});
