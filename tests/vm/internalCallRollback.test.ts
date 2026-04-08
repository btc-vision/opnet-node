import '../reorg/setup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    Address,
    AddressMap,
    BinaryReader,
    DeterministicMap,
    PointerStorage,
} from '@btc-vision/transaction';
import { ContractEvaluation } from '../../src/src/vm/runtime/classes/ContractEvaluation.js';
import { AddressStack } from '../../src/src/vm/runtime/classes/AddressStack.js';
import { MutableNumber } from '../../src/src/vm/mutables/MutableNumber.js';
import { GasTracker } from '../../src/src/vm/runtime/GasTracker.js';
import { ExecutionParameters } from '../../src/src/vm/runtime/types/InternalContractCallParameters.js';

vi.mock('../../src/src/poc/configurations/OPNetConsensus.js', () => ({
    OPNetConsensus: {
        consensus: {
            GAS: {
                TRANSACTION_MAX_GAS: 150_000_000_000n,
            },
            TRANSACTIONS: {
                MAXIMUM_CALL_DEPTH: 50,
                MAXIMUM_DEPLOYMENT_DEPTH: 2,
                MAXIMUM_UPDATE_DEPTH: 1,
                MAXIMUM_RECEIPT_LENGTH: 2048,
                REENTRANCY_GUARD: false,
                EVENTS: {
                    MAXIMUM_EVENT_LENGTH: 1024 * 1024,
                    MAXIMUM_TOTAL_EVENT_LENGTH: 1024 * 1024 * 2,
                    MAXIMUM_EVENT_NAME_LENGTH: 64,
                },
            },
            VM: {
                UTXOS: {
                    MAXIMUM_INPUTS: 10,
                    MAXIMUM_OUTPUTS: 10,
                    WRITE_FLAGS: false,
                },
            },
            PROTOCOL_ID: 1n,
        },
        consensusRules: {
            asBigInt: () => 0n,
        },
    },
}));

vi.mock('../../src/src/config/Config.js', () => ({
    Config: {
        DEV_MODE: false,
        DEBUG_LEVEL: 0,
        OP_NET: {
            REINDEX: false,
            REINDEX_FROM_BLOCK: 0,
            REINDEX_BATCH_SIZE: 1000,
            REINDEX_PURGE_UTXOS: true,
            EPOCH_REINDEX: false,
            EPOCH_REINDEX_FROM_EPOCH: 0,
            MAXIMUM_PREFETCH_BLOCKS: 10,
            MODE: 'ARCHIVE',
            LIGHT_MODE_FROM_BLOCK: 0,
        },
        DEV: {
            RESYNC_BLOCK_HEIGHTS: false,
            RESYNC_BLOCK_HEIGHTS_UNTIL: 0,
            ALWAYS_ENABLE_REORG_VERIFICATION: false,
            PROCESS_ONLY_X_BLOCK: 0,
            CAUSE_FETCHING_FAILURE: false,
            ENABLE_REORG_NIGHTMARE: false,
            ENABLE_CONTRACT_DEBUG: false,
        },
        BITCOIN: { NETWORK: 'regtest', CHAIN_ID: 0 },
        PLUGINS: { PLUGINS_ENABLED: false },
        INDEXER: {
            READONLY_MODE: false,
            STORAGE_TYPE: 'MONGODB',
            BLOCK_QUERY_INTERVAL: 100,
            START_INDEXING_UTXO_AT_BLOCK_HEIGHT: 0n,
            SOLVE_UNKNOWN_UTXOS: false,
            DISABLE_UTXO_INDEXING: false,
        },
        BLOCKCHAIN: {},
    },
}));

let addressCounter = 0;

function makeAddress(byte: number): Address {
    return new Address(new Uint8Array(32).fill(byte));
}

function uniqueAddress(): Address {
    const buf = new Uint8Array(32);
    const id = ++addressCounter;
    buf[0] = (id >> 24) & 0xff;
    buf[1] = (id >> 16) & 0xff;
    buf[2] = (id >> 8) & 0xff;
    buf[3] = id & 0xff;
    return new Address(buf);
}

function newPointerStorage(): PointerStorage {
    return new DeterministicMap<bigint, bigint>(BinaryReader.bigintCompare);
}

function makeGasTracker(maxGas: bigint = 1_000_000n): GasTracker {
    return new GasTracker(maxGas, undefined);
}

function makeEvaluationParams(overrides?: Partial<ExecutionParameters>): ExecutionParameters {
    return {
        contractAddress: uniqueAddress(),
        contractAddressStr: 'opt1test',
        calldata: new Uint8Array(4),
        txOrigin: makeAddress(0xaa),
        msgSender: makeAddress(0xbb),
        transactionId: new Uint8Array(32).fill(0xdd),
        transactionHash: new Uint8Array(32).fill(0xee),
        blockHash: new Uint8Array(32).fill(0xff),
        blockNumber: 100n,
        blockMedian: 1000n,
        gasTracker: makeGasTracker(),
        contractDeployDepth: new MutableNumber(),
        contractUpdateDepth: new MutableNumber(),
        externalCall: false,
        storage: new AddressMap<PointerStorage>(),
        preloadStorage: new AddressMap<PointerStorage>(),
        deployedContracts: new AddressMap(),
        touchedAddresses: new AddressMap(),
        callStack: new AddressStack(),
        memoryPagesUsed: 0n,
        mldsaLoadCounter: new MutableNumber(),
        isDeployment: false,
        isUpdate: false,
        inputs: [],
        outputs: [],
        serializedInputs: undefined,
        serializedOutputs: undefined,
        accessList: undefined,
        preloadStorageList: undefined,
        specialContract: undefined,
        ...overrides,
    };
}

// ── ContractEvaluation.merge() ──────────────────────────────────────────

describe('ContractEvaluation.merge', () => {
    let sharedGasTracker: GasTracker;
    let sharedStorage: AddressMap<PointerStorage>;

    beforeEach(() => {
        addressCounter = 0;
        sharedGasTracker = makeGasTracker();
        sharedStorage = new AddressMap<PointerStorage>();
    });

    function makeCallerAndExtern(externReverted: boolean) {
        const caller = new ContractEvaluation(
            makeEvaluationParams({
                gasTracker: sharedGasTracker,
                storage: sharedStorage,
            }),
        );

        const extern = new ContractEvaluation(
            makeEvaluationParams({
                gasTracker: sharedGasTracker,
                storage: sharedStorage,
                externalCall: true,
            }),
        );

        // Extern writes some storage
        const externStorage = newPointerStorage();
        externStorage.set(1n, 100n);
        extern.modifiedStorage = new AddressMap();
        extern.modifiedStorage.set(extern.contractAddress, externStorage);

        if (externReverted) {
            extern.revert = 'Subcall failed';
        } else {
            extern.result = new Uint8Array([1]);
        }

        return { caller, extern };
    }

    it('should NOT propagate revert to caller when subcall reverts', () => {
        const { caller, extern } = makeCallerAndExtern(true);

        caller.merge(extern);

        expect(caller.revert).toBeUndefined();
    });

    it('should not merge storage from reverted subcall', () => {
        const { caller, extern } = makeCallerAndExtern(true);

        caller.merge(extern);

        expect(caller.modifiedStorage).toBeUndefined();
    });

    it('should not merge events from reverted subcall', () => {
        const { caller, extern } = makeCallerAndExtern(true);

        // Add events to extern
        const eventMap = new AddressMap<any[]>();
        eventMap.set(extern.contractAddress, [{ type: 'Transfer', data: new Uint8Array(10) }]);
        extern.events = eventMap;

        caller.merge(extern);

        expect(caller.events.size).toBe(0);
    });

    it('should merge storage from successful subcall', () => {
        const { caller, extern } = makeCallerAndExtern(false);

        caller.merge(extern);

        expect(caller.modifiedStorage).toBeDefined();
        expect(caller.modifiedStorage!.size).toBe(1);
    });

    it('should merge events from successful subcall', () => {
        const { caller, extern } = makeCallerAndExtern(false);

        const eventMap = new AddressMap<any[]>();
        eventMap.set(extern.contractAddress, [{ type: 'Transfer', data: new Uint8Array(10) }]);
        extern.events = eventMap;

        caller.merge(extern);

        expect(caller.events.size).toBe(1);
    });

    it('should still update gas even when subcall reverts', () => {
        const tracker = makeGasTracker();
        const caller = new ContractEvaluation(makeEvaluationParams({ gasTracker: tracker }));
        const extern = new ContractEvaluation(
            makeEvaluationParams({ gasTracker: tracker, externalCall: true }),
        );
        extern.revert = 'fail';

        // Set gas on the extern
        tracker.setGasUsed(500n, 0n, true, caller.contractAddress);

        caller.merge(extern);

        // Caller's revert should not be set
        expect(caller.revert).toBeUndefined();
        // Gas should have been tracked
        expect(tracker.gasUsed).toBe(500n);
    });
});

// ── getEvaluationResult ─────────────────────────────────────────────────

describe('ContractEvaluation.getEvaluationResult', () => {
    beforeEach(() => {
        addressCounter = 0;
    });

    it('should return full storage when not reverted', () => {
        const evaluation = new ContractEvaluation(makeEvaluationParams());

        // Write some storage and set result
        evaluation.setStorage(1n, 42n);
        evaluation.setResult(new Uint8Array([1]));

        const result = evaluation.getEvaluationResult();

        expect(result.changedStorage).toBeDefined();
        expect(result.changedStorage!.size).toBeGreaterThan(0);
        expect(result.revert).toBeUndefined();
    });

    it('should return empty storage when reverted', () => {
        const evaluation = new ContractEvaluation(makeEvaluationParams());

        evaluation.setStorage(1n, 42n);
        evaluation.revert = 'something broke';

        const result = evaluation.getEvaluationResult();

        expect(result.changedStorage!.size).toBe(0);
        expect(result.events.size).toBe(0);
        expect(result.revert).toBeDefined();
    });

    it('should return caller state when subcall reverted but caller did not', () => {
        const tracker = makeGasTracker();
        const storage = new AddressMap<PointerStorage>();

        const caller = new ContractEvaluation(
            makeEvaluationParams({ gasTracker: tracker, storage }),
        );

        // Caller writes its own storage
        caller.setStorage(10n, 999n);

        // Simulate a reverted subcall merge,  caller should survive
        const extern = new ContractEvaluation(
            makeEvaluationParams({
                gasTracker: tracker,
                storage,
                externalCall: true,
            }),
        );
        extern.revert = 'subcall failed';
        caller.merge(extern);

        // Caller is NOT reverted
        expect(caller.revert).toBeUndefined();

        // Caller sets its result
        caller.setResult(new Uint8Array([1]));
        const result = caller.getEvaluationResult();

        expect(result.revert).toBeUndefined();
        expect(result.changedStorage).toBeDefined();
        expect(result.changedStorage!.size).toBeGreaterThan(0);
    });
});

// ── Snapshot / Restore helpers (via ContractEvaluator) ──────────────────

describe('ContractEvaluator internalCall rollback', () => {
    // We access private methods via cast to test them directly.
    // This is acceptable for unit-testing internal safety-critical logic.

    let ContractEvaluator: typeof import('../../src/src/vm/runtime/ContractEvaluator.js').ContractEvaluator;

    beforeEach(async () => {
        addressCounter = 0;
        const mod = await import('../../src/src/vm/runtime/ContractEvaluator.js');
        ContractEvaluator = mod.ContractEvaluator;
    });

    function getEvaluator(): InstanceType<typeof ContractEvaluator> {
        const { networks } = require('@btc-vision/bitcoin');
        return new ContractEvaluator(networks.regtest);
    }

    describe('snapshotStorage / restoreStorage', () => {
        it('should deep-copy storage so mutations do not affect snapshot', () => {
            const evaluator = getEvaluator() as any;

            const storage = new AddressMap<PointerStorage>();
            const addr = uniqueAddress();
            const pointers = newPointerStorage();
            pointers.set(1n, 100n);
            pointers.set(2n, 200n);
            storage.set(addr, pointers);

            const snapshot = evaluator.snapshotStorage(storage);

            // Mutate original after snapshot
            pointers.set(3n, 300n);
            pointers.set(1n, 999n);

            // Snapshot should be unaffected
            const snapshotPointers = snapshot.get(addr)!;
            expect(snapshotPointers.get(1n)).toBe(100n);
            expect(snapshotPointers.get(2n)).toBe(200n);
            expect(snapshotPointers.has(3n)).toBe(false);
        });

        it('should restore storage to snapshot state', () => {
            const evaluator = getEvaluator() as any;

            const storage = new AddressMap<PointerStorage>();
            const addr = uniqueAddress();
            const pointers = newPointerStorage();
            pointers.set(1n, 100n);
            storage.set(addr, pointers);

            const snapshot = evaluator.snapshotStorage(storage);

            // Simulate subcall mutations
            const newAddr = uniqueAddress();
            const newPointers = newPointerStorage();
            newPointers.set(5n, 500n);
            storage.set(newAddr, newPointers);
            pointers.set(1n, 999n);
            pointers.set(2n, 200n);

            // Restore
            evaluator.restoreStorage(storage, snapshot);

            expect(storage.size).toBe(1);
            expect(storage.has(newAddr)).toBe(false);

            const restored = storage.get(addr)!;
            expect(restored.get(1n)).toBe(100n);
            expect(restored.has(2n)).toBe(false);
        });

        it('should handle empty storage snapshot', () => {
            const evaluator = getEvaluator() as any;

            const storage = new AddressMap<PointerStorage>();
            const snapshot = evaluator.snapshotStorage(storage);

            // Add stuff after snapshot
            const addr = uniqueAddress();
            const pointers = newPointerStorage();
            pointers.set(1n, 100n);
            storage.set(addr, pointers);

            evaluator.restoreStorage(storage, snapshot);

            expect(storage.size).toBe(0);
        });
    });

    describe('snapshotDeployedContracts / restoreDeployedContracts', () => {
        it('should restore deployed contracts after subcall adds new ones', () => {
            const evaluator = getEvaluator() as any;

            const deployed = new AddressMap<any>();
            const existingAddr = uniqueAddress();
            deployed.set(existingAddr, { contractPublicKey: existingAddr });

            const snapshot = evaluator.snapshotDeployedContracts(deployed);

            // Subcall deploys a new contract
            const newAddr = uniqueAddress();
            deployed.set(newAddr, { contractPublicKey: newAddr });
            expect(deployed.size).toBe(2);

            evaluator.restoreDeployedContracts(deployed, snapshot);

            expect(deployed.size).toBe(1);
            expect(deployed.has(existingAddr)).toBe(true);
            expect(deployed.has(newAddr)).toBe(false);
        });
    });

    describe('MutableNumber rollback', () => {
        it('should restore MutableNumber values after failed subcall', () => {
            const deployDepth = new MutableNumber();
            const updateDepth = new MutableNumber();
            const mldsaCount = new MutableNumber();

            // Save
            const savedDeployDepth = deployDepth.value;
            const savedUpdateDepth = updateDepth.value;
            const savedMldsaCount = mldsaCount.value;

            // Simulate subcall mutations
            deployDepth.increment(1);
            updateDepth.increment(2);
            mldsaCount.increment(3);

            expect(deployDepth.value).toBe(1);
            expect(updateDepth.value).toBe(2);
            expect(mldsaCount.value).toBe(3);

            // Restore
            deployDepth.value = savedDeployDepth;
            updateDepth.value = savedUpdateDepth;
            mldsaCount.value = savedMldsaCount;

            expect(deployDepth.value).toBe(0);
            expect(updateDepth.value).toBe(0);
            expect(mldsaCount.value).toBe(0);
        });
    });

    describe('AddressStack rollback', () => {
        it('should pop entries added during failed subcall', () => {
            const stack = new AddressStack();
            const addrA = uniqueAddress();
            stack.push(addrA);

            const savedLength = stack.length;

            // Subcall pushes
            const addrB = uniqueAddress();
            const addrC = uniqueAddress();
            stack.push(addrB);
            stack.push(addrC);

            expect(stack.length).toBe(3);

            // Restore
            while (stack.length > savedLength) {
                stack.pop();
            }

            expect(stack.length).toBe(1);
            expect(stack.includes(addrA)).toBe(true);
            expect(stack.includes(addrB)).toBe(false);
            expect(stack.includes(addrC)).toBe(false);
        });
    });
});

// ── Integration: full internalCall flow ─────────────────────────────────

describe('ContractEvaluator internalCall integration', () => {
    let ContractEvaluator: typeof import('../../src/src/vm/runtime/ContractEvaluator.js').ContractEvaluator;

    beforeEach(async () => {
        addressCounter = 0;
        const mod = await import('../../src/src/vm/runtime/ContractEvaluator.js');
        ContractEvaluator = mod.ContractEvaluator;
    });

    function getEvaluator(): InstanceType<typeof ContractEvaluator> {
        const { networks } = require('@btc-vision/bitcoin');
        return new ContractEvaluator(networks.regtest);
    }

    it('should not poison caller evaluation when subcall reverts', async () => {
        const evaluator = getEvaluator() as any;
        const tracker = makeGasTracker();
        const sharedStorage = new AddressMap<PointerStorage>();

        const callerAddr = uniqueAddress();
        const targetAddr = uniqueAddress();

        const callerEval = new ContractEvaluation(
            makeEvaluationParams({
                contractAddress: callerAddr,
                gasTracker: tracker,
                storage: sharedStorage,
            }),
        );

        // Caller writes storage before the subcall
        callerEval.setStorage(10n, 42n);

        // Mock callExternal: subcall writes to shared storage DURING execution, then reverts
        evaluator.callExternal = vi.fn().mockImplementation(async () => {
            // Simulate the subcall writing to the shared storage map
            const subcallPointers = newPointerStorage();
            subcallPointers.set(99n, 777n);
            sharedStorage.set(targetAddr, subcallPointers);

            const revertedEval = new ContractEvaluation(
                makeEvaluationParams({
                    contractAddress: targetAddr,
                    gasTracker: tracker,
                    storage: sharedStorage,
                    externalCall: true,
                }),
            );
            revertedEval.revert = 'OP_NET: Subcall failed';
            return revertedEval;
        });

        const result = await evaluator.internalCall({
            evaluation: callerEval,
            calldata: new Uint8Array(4),
            isDeployment: false,
            isUpdate: false,
            contractAddress: targetAddr,
        });

        // Subcall returned failure status
        expect(result.status).toBe(1);

        // Caller's evaluation is NOT poisoned
        expect(callerEval.revert).toBeUndefined();

        // Subcall's storage writes were rolled back from the shared map
        expect(sharedStorage.has(targetAddr)).toBe(false);

        // Caller's own storage writes are preserved
        const callerStorage = sharedStorage.get(callerAddr);
        expect(callerStorage).toBeDefined();
        expect(callerStorage!.get(10n)).toBe(42n);
    });

    it('should merge state normally when subcall succeeds', async () => {
        const evaluator = getEvaluator() as any;
        const tracker = makeGasTracker();
        const sharedStorage = new AddressMap<PointerStorage>();

        const callerAddr = uniqueAddress();
        const targetAddr = uniqueAddress();

        const callerEval = new ContractEvaluation(
            makeEvaluationParams({
                contractAddress: callerAddr,
                gasTracker: tracker,
                storage: sharedStorage,
            }),
        );

        // Mock callExternal to return a successful evaluation
        const successEval = new ContractEvaluation(
            makeEvaluationParams({
                contractAddress: targetAddr,
                gasTracker: tracker,
                storage: sharedStorage,
                externalCall: true,
            }),
        );
        successEval.result = new Uint8Array([1]);

        // Subcall wrote some modified storage
        const modStorage = new AddressMap<any>();
        const targetPointers = newPointerStorage();
        targetPointers.set(50n, 500n);
        modStorage.set(targetAddr, targetPointers);
        successEval.modifiedStorage = modStorage;

        evaluator.callExternal = vi.fn().mockResolvedValue(successEval);

        const result = await evaluator.internalCall({
            evaluation: callerEval,
            calldata: new Uint8Array(4),
            isDeployment: false,
            isUpdate: false,
            contractAddress: targetAddr,
        });

        expect(result.status).toBe(0);
        expect(callerEval.revert).toBeUndefined();

        // Subcall's modified storage was merged into caller
        expect(callerEval.modifiedStorage).toBeDefined();
        expect(callerEval.modifiedStorage!.size).toBe(1);
    });

    it('should restore MutableNumbers when subcall reverts', async () => {
        const evaluator = getEvaluator() as any;
        const tracker = makeGasTracker();
        const sharedStorage = new AddressMap<PointerStorage>();

        const deployDepth = new MutableNumber();
        const updateDepth = new MutableNumber();
        const mldsaCounter = new MutableNumber();

        const callerAddr = uniqueAddress();
        const targetAddr = uniqueAddress();

        const callerEval = new ContractEvaluation(
            makeEvaluationParams({
                contractAddress: callerAddr,
                gasTracker: tracker,
                storage: sharedStorage,
                contractDeployDepth: deployDepth,
                contractUpdateDepth: updateDepth,
                mldsaLoadCounter: mldsaCounter,
            }),
        );

        // Mock callExternal that increments MutableNumbers before reverting
        evaluator.callExternal = vi.fn().mockImplementation(async () => {
            deployDepth.increment(1);
            updateDepth.increment(1);
            mldsaCounter.increment(1);

            const reverted = new ContractEvaluation(
                makeEvaluationParams({
                    contractAddress: targetAddr,
                    gasTracker: tracker,
                    storage: sharedStorage,
                    externalCall: true,
                }),
            );
            reverted.revert = 'fail';
            return reverted;
        });

        await evaluator.internalCall({
            evaluation: callerEval,
            calldata: new Uint8Array(4),
            isDeployment: false,
            isUpdate: false,
            contractAddress: targetAddr,
        });

        // MutableNumbers should be restored to pre-call values
        expect(deployDepth.value).toBe(0);
        expect(updateDepth.value).toBe(0);
        expect(mldsaCounter.value).toBe(0);
    });

    it('should restore callStack when subcall reverts', async () => {
        const evaluator = getEvaluator() as any;
        const tracker = makeGasTracker();
        const sharedStorage = new AddressMap<PointerStorage>();
        const callStack = new AddressStack();

        const callerAddr = uniqueAddress();
        const targetAddr = uniqueAddress();

        callStack.push(callerAddr);

        const callerEval = new ContractEvaluation(
            makeEvaluationParams({
                contractAddress: callerAddr,
                gasTracker: tracker,
                storage: sharedStorage,
                callStack,
            }),
        );

        evaluator.callExternal = vi.fn().mockImplementation(async () => {
            // Subcall pushes its address (done by ContractEvaluation constructor)
            callStack.push(targetAddr);

            const reverted = new ContractEvaluation(
                makeEvaluationParams({
                    contractAddress: targetAddr,
                    gasTracker: tracker,
                    storage: sharedStorage,
                    externalCall: true,
                }),
            );
            reverted.revert = 'fail';
            return reverted;
        });

        await evaluator.internalCall({
            evaluation: callerEval,
            calldata: new Uint8Array(4),
            isDeployment: false,
            isUpdate: false,
            contractAddress: targetAddr,
        });

        // callStack should be restored,  only caller's address remains
        // Note: callerEval constructor also pushed callerAddr, so there may be 2 entries
        // from the constructor. We check targetAddr is gone.
        expect(callStack.includes(targetAddr)).toBe(false);
        expect(callStack.includes(callerAddr)).toBe(true);
    });

    it('should restore deployedContracts when subcall reverts', async () => {
        const evaluator = getEvaluator() as any;
        const tracker = makeGasTracker();
        const sharedStorage = new AddressMap<PointerStorage>();
        const deployed = new AddressMap<any>();

        const callerAddr = uniqueAddress();
        const targetAddr = uniqueAddress();

        // Pre-existing deployed contract
        const existingContract = uniqueAddress();
        deployed.set(existingContract, { contractPublicKey: existingContract });

        const callerEval = new ContractEvaluation(
            makeEvaluationParams({
                contractAddress: callerAddr,
                gasTracker: tracker,
                storage: sharedStorage,
                deployedContracts: deployed,
            }),
        );

        evaluator.callExternal = vi.fn().mockImplementation(async () => {
            // Subcall deploys a contract
            const newContract = uniqueAddress();
            deployed.set(newContract, { contractPublicKey: newContract });

            const reverted = new ContractEvaluation(
                makeEvaluationParams({
                    contractAddress: targetAddr,
                    gasTracker: tracker,
                    storage: sharedStorage,
                    externalCall: true,
                }),
            );
            reverted.revert = 'fail';
            return reverted;
        });

        await evaluator.internalCall({
            evaluation: callerEval,
            calldata: new Uint8Array(4),
            isDeployment: false,
            isUpdate: false,
            contractAddress: targetAddr,
        });

        // Only the pre-existing contract should remain
        expect(deployed.size).toBe(1);
        expect(deployed.has(existingContract)).toBe(true);
    });

    it('should handle nested A→B→C where B reverts after C succeeds', async () => {
        // This is the scenario from the bug report:
        // A calls B, B calls C (C succeeds), B then reverts.
        // C's state must NOT leak.

        const evaluator = getEvaluator() as any;
        const tracker = makeGasTracker();
        const sharedStorage = new AddressMap<PointerStorage>();

        const addrA = uniqueAddress();
        const addrB = uniqueAddress();
        const addrC = uniqueAddress();

        const evalA = new ContractEvaluation(
            makeEvaluationParams({
                contractAddress: addrA,
                gasTracker: tracker,
                storage: sharedStorage,
            }),
        );

        // A writes its own storage
        evalA.setStorage(1n, 10n);

        // Mock: when A calls B, B internally calls C (C succeeds and writes),
        // then B reverts.
        evaluator.callExternal = vi.fn().mockImplementation(async () => {
            // Simulate C writing to shared storage (as if C succeeded)
            const cPointers = newPointerStorage();
            cPointers.set(50n, 500n);
            sharedStorage.set(addrC, cPointers);

            // Simulate B writing to shared storage
            const bPointers = newPointerStorage();
            bPointers.set(20n, 200n);
            sharedStorage.set(addrB, bPointers);

            // B reverts
            const revertedB = new ContractEvaluation(
                makeEvaluationParams({
                    contractAddress: addrB,
                    gasTracker: tracker,
                    storage: sharedStorage,
                    externalCall: true,
                }),
            );
            revertedB.revert = 'B failed after C succeeded';
            return revertedB;
        });

        const result = await evaluator.internalCall({
            evaluation: evalA,
            calldata: new Uint8Array(4),
            isDeployment: false,
            isUpdate: false,
            contractAddress: addrB,
        });

        expect(result.status).toBe(1);

        // A is NOT reverted
        expect(evalA.revert).toBeUndefined();

        // B's storage writes are rolled back
        expect(sharedStorage.has(addrB)).toBe(false);

        // C's storage writes are ALSO rolled back (C was part of B's subtree)
        expect(sharedStorage.has(addrC)).toBe(false);

        // A's own storage writes are preserved
        const aStorage = sharedStorage.get(addrA);
        expect(aStorage).toBeDefined();
        expect(aStorage!.get(1n)).toBe(10n);
    });

    it('should restore preloadStorage when subcall reverts (cold load leak prevention)', async () => {
        const evaluator = getEvaluator() as any;
        const tracker = makeGasTracker();
        const sharedStorage = new AddressMap<PointerStorage>();
        const sharedPreload = new AddressMap<PointerStorage>();

        const callerAddr = uniqueAddress();
        const targetAddr = uniqueAddress();

        const callerEval = new ContractEvaluation(
            makeEvaluationParams({
                contractAddress: callerAddr,
                gasTracker: tracker,
                storage: sharedStorage,
                preloadStorage: sharedPreload,
            }),
        );

        // Mock: subcall performs a cold storage load (adds to preloadStorage), then reverts
        evaluator.callExternal = vi.fn().mockImplementation(async () => {
            // Simulate cold load caching in preloadStorage
            const coldPointers = newPointerStorage();
            coldPointers.set(42n, 12345n);
            sharedPreload.set(targetAddr, coldPointers);

            const reverted = new ContractEvaluation(
                makeEvaluationParams({
                    contractAddress: targetAddr,
                    gasTracker: tracker,
                    storage: sharedStorage,
                    preloadStorage: sharedPreload,
                    externalCall: true,
                }),
            );
            reverted.revert = 'fail';
            return reverted;
        });

        await evaluator.internalCall({
            evaluation: callerEval,
            calldata: new Uint8Array(4),
            isDeployment: false,
            isUpdate: false,
            contractAddress: targetAddr,
        });

        // Cold loads from the failed subcall must NOT persist in preloadStorage.
        // If they did, a subsequent load of the same pointer would see a warm hit
        // instead of a cold load, causing gas accounting divergence.
        expect(sharedPreload.has(targetAddr)).toBe(false);
    });

    it('should restore snapshot when callExternal throws an exception', async () => {
        const evaluator = getEvaluator() as any;
        const tracker = makeGasTracker();
        const sharedStorage = new AddressMap<PointerStorage>();

        const callerAddr = uniqueAddress();
        const targetAddr = uniqueAddress();

        const callerEval = new ContractEvaluation(
            makeEvaluationParams({
                contractAddress: callerAddr,
                gasTracker: tracker,
                storage: sharedStorage,
            }),
        );

        // Caller writes storage before the call
        callerEval.setStorage(10n, 42n);

        // Mock: callExternal mutates shared state then throws (infrastructure failure)
        evaluator.callExternal = vi.fn().mockImplementation(async () => {
            const badPointers = newPointerStorage();
            badPointers.set(99n, 666n);
            sharedStorage.set(targetAddr, badPointers);

            throw new Error('DB connection lost');
        });

        await expect(
            evaluator.internalCall({
                evaluation: callerEval,
                calldata: new Uint8Array(4),
                isDeployment: false,
                isUpdate: false,
                contractAddress: targetAddr,
            }),
        ).rejects.toThrow('DB connection lost');

        // Even though callExternal threw, shared state should be restored
        expect(sharedStorage.has(targetAddr)).toBe(false);

        // Caller's own storage is preserved
        const callerStorage = sharedStorage.get(callerAddr);
        expect(callerStorage).toBeDefined();
        expect(callerStorage!.get(10n)).toBe(42n);
    });

    it('should handle multiple sequential subcalls with mixed success/failure', async () => {
        const evaluator = getEvaluator() as any;
        const tracker = makeGasTracker();
        const sharedStorage = new AddressMap<PointerStorage>();

        const callerAddr = uniqueAddress();
        const target1 = uniqueAddress();
        const target2 = uniqueAddress();
        const target3 = uniqueAddress();

        const callerEval = new ContractEvaluation(
            makeEvaluationParams({
                contractAddress: callerAddr,
                gasTracker: tracker,
                storage: sharedStorage,
            }),
        );

        callerEval.setStorage(1n, 10n);

        // Call 1: FAILS,  writes to target1, reverts
        evaluator.callExternal = vi.fn().mockImplementation(async () => {
            const p = newPointerStorage();
            p.set(100n, 1000n);
            sharedStorage.set(target1, p);

            const reverted = new ContractEvaluation(
                makeEvaluationParams({
                    contractAddress: target1,
                    gasTracker: tracker,
                    storage: sharedStorage,
                    externalCall: true,
                }),
            );
            reverted.revert = 'call 1 failed';
            return reverted;
        });

        const r1 = await evaluator.internalCall({
            evaluation: callerEval,
            calldata: new Uint8Array(4),
            isDeployment: false,
            isUpdate: false,
            contractAddress: target1,
        });
        expect(r1.status).toBe(1);
        expect(sharedStorage.has(target1)).toBe(false);

        // Call 2: SUCCEEDS,  writes to target2
        evaluator.callExternal = vi.fn().mockImplementation(async () => {
            const p = newPointerStorage();
            p.set(200n, 2000n);
            sharedStorage.set(target2, p);

            const success = new ContractEvaluation(
                makeEvaluationParams({
                    contractAddress: target2,
                    gasTracker: tracker,
                    storage: sharedStorage,
                    externalCall: true,
                }),
            );
            success.result = new Uint8Array([1]);
            const modStorage = new AddressMap<any>();
            const tp = newPointerStorage();
            tp.set(200n, 2000n);
            modStorage.set(target2, tp);
            success.modifiedStorage = modStorage;
            return success;
        });

        const r2 = await evaluator.internalCall({
            evaluation: callerEval,
            calldata: new Uint8Array(4),
            isDeployment: false,
            isUpdate: false,
            contractAddress: target2,
        });
        expect(r2.status).toBe(0);

        // Call 3: FAILS,  writes to target3, reverts
        evaluator.callExternal = vi.fn().mockImplementation(async () => {
            const p = newPointerStorage();
            p.set(300n, 3000n);
            sharedStorage.set(target3, p);

            const reverted = new ContractEvaluation(
                makeEvaluationParams({
                    contractAddress: target3,
                    gasTracker: tracker,
                    storage: sharedStorage,
                    externalCall: true,
                }),
            );
            reverted.revert = 'call 3 failed';
            return reverted;
        });

        const r3 = await evaluator.internalCall({
            evaluation: callerEval,
            calldata: new Uint8Array(4),
            isDeployment: false,
            isUpdate: false,
            contractAddress: target3,
        });
        expect(r3.status).toBe(1);

        // Final state: only caller + target2 (successful call) should have storage
        expect(callerEval.revert).toBeUndefined();
        expect(sharedStorage.has(target1)).toBe(false); // failed, rolled back
        expect(sharedStorage.has(target2)).toBe(true); // succeeded
        expect(sharedStorage.has(target3)).toBe(false); // failed, rolled back

        // Caller's own storage preserved throughout
        const callerStorage = sharedStorage.get(callerAddr);
        expect(callerStorage).toBeDefined();
        expect(callerStorage!.get(1n)).toBe(10n);

        // Successful call's modified storage was merged
        expect(callerEval.modifiedStorage).toBeDefined();
        expect(callerEval.modifiedStorage!.size).toBe(1);
    });
});
