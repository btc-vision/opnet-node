import '../reorg/setup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Address, AddressMap, BinaryReader, DeterministicMap, PointerStorage, } from '@btc-vision/transaction';
import { toBase64 } from '@btc-vision/bitcoin';
import { ContractEvaluation } from '../../src/src/vm/runtime/classes/ContractEvaluation.js';
import { AddressStack } from '../../src/src/vm/runtime/classes/AddressStack.js';
import { MutableNumber } from '../../src/src/vm/mutables/MutableNumber.js';
import { GasTracker } from '../../src/src/vm/runtime/GasTracker.js';
import { ExecutionParameters } from '../../src/src/vm/runtime/types/InternalContractCallParameters.js';
import { AccessList } from '../../src/src/api/json-rpc/types/interfaces/results/states/CallResult.js';

vi.mock('../../src/src/poc/configurations/OPNetConsensus.js', () => ({
    OPNetConsensus: {
        consensus: {
            GAS: { TRANSACTION_MAX_GAS: 150_000_000_000n },
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
        consensusRules: { asBigInt: () => 0n },
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

function uniqueAddress(): Address {
    const buf = new Uint8Array(32);
    const id = ++addressCounter;
    buf[0] = (id >> 24) & 0xff;
    buf[1] = (id >> 16) & 0xff;
    buf[2] = (id >> 8) & 0xff;
    buf[3] = id & 0xff;

    for (let i = 4; i < 32; i++) buf[i] = (id + i) & 0xff;
    return new Address(buf);
}

function bigintTo32ByteBase64(value: bigint): string {
    const buf = new Uint8Array(32);
    let v = value;
    for (let i = 31; i >= 0; i--) {
        buf[i] = Number(v & 0xffn);
        v >>= 8n;
    }
    return toBase64(buf);
}

function buildAccessList(
    entries: ReadonlyArray<{
        readonly contract: Address;
        readonly slots: ReadonlyArray<{ readonly key: bigint; readonly value: bigint }>;
    }>,
): AccessList {
    const out: AccessList = {};
    for (const entry of entries) {
        const contractStorage: { [slot: string]: string } = {};
        for (const slot of entry.slots) {
            contractStorage[bigintTo32ByteBase64(slot.key)] = bigintTo32ByteBase64(slot.value);
        }
        out[entry.contract.toHex()] = contractStorage;
    }
    return out;
}

function newPointerStorage(): PointerStorage {
    return new DeterministicMap<bigint, bigint>(BinaryReader.bigintCompare);
}

function makeGasTracker(maxGas: bigint = 1_000_000n): GasTracker {
    return new GasTracker(maxGas, undefined);
}

function makeParams(overrides?: Partial<ExecutionParameters>): ExecutionParameters {
    return {
        contractAddress: uniqueAddress(),
        contractAddressStr: 'opt1test',
        calldata: new Uint8Array(4),
        txOrigin: uniqueAddress(),
        msgSender: uniqueAddress(),
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

describe('ContractEvaluation.parseAccessList', () => {
    beforeEach(() => {
        addressCounter = 0;
    });

    // Baseline: the top-level parse writes its overlay into the shared storage map.
    it('top-level evaluation applies overlay slots for its own contract', () => {
        const storage = new AddressMap<PointerStorage>();
        const contractA = uniqueAddress();

        const accessList = buildAccessList([
            { contract: contractA, slots: [{ key: 1n, value: 42n }] },
        ]);

        const evaluation = new ContractEvaluation(
            makeParams({ contractAddress: contractA, storage, accessList }),
        );

        const slots = evaluation.storage.get(contractA);
        expect(slots).toBeDefined();

        if (!slots) {
            throw new Error(`not found`);
        }

        expect(slots.get(1n)).toBe(42n);
    });

    // Override targets a contract OTHER than the top-level one. parseAccessList iterates ALL contracts in the access list, so
    // the override still lands in the shared storage map,child evaluations inherit it
    // by reference without having to re-parse.
    it('top-level parse writes overlay for contracts other than the top-level contract', () => {
        const storage = new AddressMap<PointerStorage>();
        const contractA = uniqueAddress();
        const contractB = uniqueAddress();

        const accessList = buildAccessList([
            { contract: contractB, slots: [{ key: 7n, value: 777n }] },
        ]);

        const evaluation = new ContractEvaluation(
            makeParams({ contractAddress: contractA, storage, accessList }),
        );

        // Top-level contract is A, but the overlay for B landed in the shared map.
        const slotsB = evaluation.storage.get(contractB);
        expect(slotsB).toBeDefined();

        if (!slotsB) {
            throw new Error(`not found`);
        }

        expect(slotsB.get(7n)).toBe(777n);
    });

    // Child (externalCall=true) evaluation must NOT re-parse the access list.
    // If it did, `current.set(pointerKey, pointerValue)` would blindly overwrite slots
    // the parent had mutated during execution,exactly the
    // `MotoswapExtendedLibrary: INSUFFICIENT_INPUT_AMOUNT` failure mode.
    it('child evaluation (externalCall=true) does NOT stomp parent writes', () => {
        const storage = new AddressMap<PointerStorage>();
        const tracker = makeGasTracker();
        const tokenIn = uniqueAddress();

        // Overlay says pair's tokenIn balance slot = reserveIn + txIn (say 100).
        // Imagine this came back from a prior tx simulation's accessList output.
        const accessList = buildAccessList([
            { contract: tokenIn, slots: [{ key: 1n, value: 100n }] },
        ]);

        // Top-level call targets tokenIn (simulating the victim's transferFrom).
        const parent = new ContractEvaluation(
            makeParams({
                contractAddress: tokenIn,
                storage,
                gasTracker: tracker,
                accessList,
            }),
        );

        // Overlay landed.
        expect(parent.storage.get(tokenIn)!.get(1n)).toBe(100n);

        // Emulate that by directly calling setStorage,which is what the VM bridge does
        // when the contract's _transfer writes pair.balance[tokenIn] += victim.amountIn.
        parent.setStorage(1n, 150n);
        expect(parent.storage.get(tokenIn)!.get(1n)).toBe(150n);

        // Now the parent fires an internal call (e.g. the router doing balanceOf(pair)),
        // which spawns a child evaluation for tokenIn with the same shared storage,
        // accessList forwarded, and externalCall=true.
        new ContractEvaluation(
            makeParams({
                contractAddress: tokenIn,
                storage,
                gasTracker: tracker,
                accessList,
                externalCall: true,
            }),
        );

        // The parent's mid-execution write MUST still be there. Without the fix, the
        // child's constructor would have reparsed the accessList and stomped 150n → 100n.
        expect(parent.storage.get(tokenIn)!.get(1n)).toBe(150n);
    });

    // The child evaluation can still observe the overlay values for
    // contracts it hasn't touched yet, because the shared storage map carries them from
    // the top-level parse.
    it('child evaluation observes overlay slots via shared storage map', () => {
        const storage = new AddressMap<PointerStorage>();
        const tracker = makeGasTracker();
        const tokenA = uniqueAddress();
        const tokenB = uniqueAddress();

        const accessList = buildAccessList([
            { contract: tokenB, slots: [{ key: 5n, value: 999n }] },
        ]);

        // Top-level is tokenA, so the overlay for tokenB was added by parseAccessList
        // at top level. The child for tokenB should see it without having to re-parse.
        new ContractEvaluation(
            makeParams({
                contractAddress: tokenA,
                storage,
                gasTracker: tracker,
                accessList,
            }),
        );

        const child = new ContractEvaluation(
            makeParams({
                contractAddress: tokenB,
                storage,
                gasTracker: tracker,
                accessList,
                externalCall: true,
            }),
        );

        expect(child.storage.get(tokenB)!.get(5n)).toBe(999n);
    });

    // If the child is the only evaluation that ever touched a contract, and the overlay
    // was NOT seeded by a prior top-level parse, there's no magic path to read the
    // overlay value,but that path isn't supposed to exist either, because the top-level
    // evaluation is always the one that receives the accessList from the RPC boundary.
    // This test documents that invariant and guards against anyone re-introducing an
    // implicit re-parse in the external-call constructor path.
    it('access list passed to a lone external-call constructor is ignored', () => {
        const storage = new AddressMap<PointerStorage>();
        const tracker = makeGasTracker();
        const tokenB = uniqueAddress();

        const accessList = buildAccessList([
            { contract: tokenB, slots: [{ key: 3n, value: 333n }] },
        ]);

        new ContractEvaluation(
            makeParams({
                contractAddress: tokenB,
                storage,
                gasTracker: tracker,
                accessList,
                externalCall: true,
            }),
        );

        // The external-call constructor deliberately skips parseAccessList, so the
        // overlay slot should not have been written to the shared storage map.
        const slots = storage.get(tokenB);
        expect(slots?.get(3n)).toBeUndefined();
    });

    // End-to-end reproduction of the motoswap INSUFFICIENT_INPUT_AMOUNT chain.
    //
    //   1. Sim returned an access list with pair.balance[tokenIn] = R.
    //   2. Victim router call starts with that overlay. During execution the router's
    //      internal call to tokenIn.transferFrom increments pair.balance[tokenIn] to R+V.
    //   3. The router then reads the balance via a fresh internal call to
    //      tokenIn.balanceOf(pair). That spawns ANOTHER external evaluation for tokenIn
    //      with the same access list.
    //   4. If parseAccessList re-runs in step 3, it stomps R+V → R, so the router
    //      sees `amountInput = R - R = 0` and throws INSUFFICIENT_INPUT_AMOUNT.
    //
    // This test reproduces that exact sequence at the evaluation layer and asserts the
    // balance read in step 3 returns the post-transfer value, not the overlay value.
    it('reproduces the motoswap state-stomp chain and stays consistent', () => {
        const storage = new AddressMap<PointerStorage>();
        const tracker = makeGasTracker();
        const tokenIn = uniqueAddress();
        const pair = uniqueAddress();

        const BALANCE_SLOT = 1n;
        const BALANCE = 1000n;
        const VICTIM_DELTA = 250n;
        const POST_TRANSFER = BALANCE + VICTIM_DELTA;

        const txAccessList = buildAccessList([
            { contract: tokenIn, slots: [{ key: BALANCE_SLOT, value: BALANCE }] },
        ]);

        // Step 1-2: victim router's top-level evaluation is the router, but in our
        // simplified model we focus on the tokenIn state. Top-level evaluation here
        // represents the victim router; it receives and parses the overlay.
        const router = uniqueAddress();
        const victimRouter = new ContractEvaluation(
            makeParams({
                contractAddress: router,
                storage,
                gasTracker: tracker,
                accessList: txAccessList,
            }),
        );

        // Internal call #1: tokenIn.transferFrom. It writes pair balance (R + V).
        const transferFromCall = new ContractEvaluation(
            makeParams({
                contractAddress: tokenIn,
                storage,
                gasTracker: tracker,
                accessList: txAccessList,
                externalCall: true,
            }),
        );
        transferFromCall.setStorage(BALANCE_SLOT, POST_TRANSFER);
        expect(victimRouter.storage.get(tokenIn)!.get(BALANCE_SLOT)).toBe(POST_TRANSFER);

        // Internal call #2: tokenIn.balanceOf(pair). Just creating the evaluation is
        // what would have triggered the stomp. After the fix, the constructor must not
        // reparse,so the slot value stays at POST_TRANSFER.
        new ContractEvaluation(
            makeParams({
                contractAddress: tokenIn,
                storage,
                gasTracker: tracker,
                accessList: txAccessList,
                externalCall: true,
            }),
        );

        const balanceRead = victimRouter.storage.get(tokenIn)!.get(BALANCE_SLOT);
        expect(balanceRead).toBe(POST_TRANSFER);

        // And the delta the router would compute is non-zero:
        const amountInput = balanceRead! - BALANCE;
        expect(amountInput).toBe(VICTIM_DELTA);
        expect(amountInput).toBeGreaterThan(0n);
    });
});
