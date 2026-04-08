import '../reorg/setup.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Address, AddressMap } from '@btc-vision/transaction';

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

function makeContractInfo(blockHeight: bigint, contractPublicKey: Address) {
    return {
        blockHeight,
        contractAddress: 'opt1mock',
        contractPublicKey,
        bytecode: new Uint8Array(64).fill(0x42),
        wasCompressed: false,
        deployedTransactionId: new Uint8Array(32),
        deployedTransactionHash: new Uint8Array(32),
        deployerPubKey: new Uint8Array(33),
        contractSeed: new Uint8Array(32),
        contractSaltHash: new Uint8Array(32),
        deployerAddress: makeAddress(0xbb),
    };
}

function makeMockEvaluation(blockNumber: bigint) {
    const deployedContracts = new AddressMap();
    return {
        blockNumber,
        contractAddress: makeAddress(0x01),
        gasUsed: 0n,
        transactionId: new Uint8Array(32).fill(0xdd),
        transactionHash: new Uint8Array(32).fill(0xee),
        deployedContracts,
        addContractInformation: vi.fn(
            (contract: { contractPublicKey: Address; blockHeight: bigint }) => {
                if (deployedContracts.has(contract.contractPublicKey)) {
                    throw new Error('OP_NET: Contract already deployed.');
                }
                deployedContracts.set(contract.contractPublicKey, contract);
            },
        ),
    };
}

interface StoredContract {
    address: string;
    blockHeight: bigint;
    info: ReturnType<typeof makeContractInfo>;
}

/**
 * Stateful in-memory mock of the MongoDB contracts collection.
 * Implements real {@link https://www.mongodb.com/docs/manual/reference/operator/query/lte/ | $lte} /
 * {@link https://www.mongodb.com/docs/manual/reference/operator/query/gte/ | $gte} query semantics
 * so tests validate actual state transitions, not mock return values.
 */
class InMemoryContractDB {
    private contracts: StoredContract[] = [];

    /** @returns contract info where {@link blockHeight} `<= height`, or `undefined`. */
    getContractAt(
        addressHex: string,
        height?: bigint,
    ): ReturnType<typeof makeContractInfo> | undefined {
        if (height === undefined) {
            return this.contracts.find((c) => c.address === addressHex)?.info;
        }
        return this.contracts.find((c) => c.address === addressHex && c.blockHeight <= height)
            ?.info;
    }

    /** @throws if a contract with the same address already exists. */
    setContractAt(
        addressHex: string,
        blockHeight: bigint,
        info: ReturnType<typeof makeContractInfo>,
    ): void {
        const exists = this.contracts.find((c) => c.address === addressHex);
        if (exists) {
            throw new Error('OP_NET: Contract already exists');
        }
        this.contracts.push({ address: addressHex, blockHeight, info });
    }

    /** Deletes all contracts where {@link blockHeight} `>= height`. */
    deleteContractsFromBlockHeight(height: bigint): void {
        this.contracts = this.contracts.filter((c) => c.blockHeight < height);
    }

    size(): number {
        return this.contracts.length;
    }

    has(addressHex: string): boolean {
        return this.contracts.some((c) => c.address === addressHex);
    }

    dump(): StoredContract[] {
        return [...this.contracts];
    }
}

/**
 * Mirrors the VMManager block-processing pipeline: deploy checks across
 * three duplicate-detection layers, terminateEvaluation, revertBlock, and finalizeBlock.
 */
class BlockProcessor {
    public contractCache: AddressMap<ReturnType<typeof makeContractInfo>> = new AddressMap();
    public db: InMemoryContractDB;

    constructor(db: InMemoryContractDB) {
        this.db = db;
    }

    /**
     * Three-layer duplicate detection matching {@link VMManager.deployContractAtAddress}.
     * @returns the deployed address on success, or `null` if the address already exists.
     */
    async deploy(
        deployAddress: Address,
        blockNumber: bigint,
        evaluation: ReturnType<typeof makeMockEvaluation>,
    ): Promise<Address | null> {
        if (this.contractCache.has(deployAddress)) {
            throw new Error('Contract already deployed. (cache)');
        }

        const exists = this.db.getContractAt(deployAddress.toHex(), blockNumber - 1n);
        if (exists) {
            return null;
        }

        const info = makeContractInfo(blockNumber, deployAddress);
        evaluation.addContractInformation({
            ...info,
            contractPublicKey: deployAddress,
            blockHeight: blockNumber,
        });

        return deployAddress;
    }

    /** Writes deployed contracts from the evaluation to both cache and DB. */
    terminateEvaluation(evaluation: ReturnType<typeof makeMockEvaluation>): void {
        for (const [addr, contract] of evaluation.deployedContracts.entries()) {
            const info = makeContractInfo((contract as { blockHeight: bigint }).blockHeight, addr);
            this.contractCache.set(addr, info);
            this.db.setContractAt(addr.toHex(), info.blockHeight, info);
        }
    }

    /** Processes a single TX that deploys {@link subContractAddresses} and runs terminateEvaluation. */
    async processTx(
        subContractAddresses: Address[],
        blockNumber: bigint,
    ): Promise<{ evaluation: ReturnType<typeof makeMockEvaluation>; deployed: Address[] }> {
        const evaluation = makeMockEvaluation(blockNumber);
        const deployed: Address[] = [];

        for (const addr of subContractAddresses) {
            const result = await this.deploy(addr, blockNumber, evaluation);
            if (result) deployed.push(result);
        }

        this.terminateEvaluation(evaluation);
        return { evaluation, deployed };
    }

    /** Deletes contracts at `>= blockHeight` from DB and clears the cache. */
    revertBlock(blockHeight: bigint): void {
        if (blockHeight > 0n) {
            this.db.deleteContractsFromBlockHeight(blockHeight);
        }
        this.contractCache.clear();
    }

    /** Clears the cache for the next block (normal commit path). */
    finalizeBlock(): void {
        this.contractCache.clear();
    }
}

beforeEach(() => {
    addressCounter = 0;
});

describe('DB query uses blockNumber - 1n', () => {
    it('stale contract at current block height is invisible to deploy check', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);
        const addr = uniqueAddress();

        db.setContractAt(addr.toHex(), 500n, makeContractInfo(500n, addr));

        const eval1 = makeMockEvaluation(500n);
        const result = await proc.deploy(addr, 500n, eval1);

        expect(result).toBe(addr);
    });

    it('legitimate contract from a prior block is found', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);
        const addr = uniqueAddress();

        db.setContractAt(addr.toHex(), 400n, makeContractInfo(400n, addr));

        const eval1 = makeMockEvaluation(500n);
        const result = await proc.deploy(addr, 500n, eval1);

        expect(result).toBeNull();
    });

    it('stale contract 1 block ahead (1-block reorg) is invisible', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);
        const addr = uniqueAddress();

        db.setContractAt(addr.toHex(), 501n, makeContractInfo(501n, addr));

        const eval1 = makeMockEvaluation(500n);
        const result = await proc.deploy(addr, 500n, eval1);

        expect(result).toBe(addr);
    });
});

describe('Three-layer duplicate detection', () => {
    it('same-TX: second deploy of same address in one TX throws', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);
        const addr = uniqueAddress();
        const evaluation = makeMockEvaluation(100n);

        await proc.deploy(addr, 100n, evaluation);
        await expect(proc.deploy(addr, 100n, evaluation)).rejects.toThrow(
            'OP_NET: Contract already deployed.',
        );
    });

    it('same-block: second TX deploying same address caught by cache', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);
        const addr = uniqueAddress();

        await proc.processTx([addr], 100n);

        const eval2 = makeMockEvaluation(100n);
        await expect(proc.deploy(addr, 100n, eval2)).rejects.toThrow(
            'Contract already deployed. (cache)',
        );
    });

    it('cross-block: contract from block N blocks deployment in block N+1 via DB', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);
        const addr = uniqueAddress();

        await proc.processTx([addr], 100n);
        proc.finalizeBlock();

        const eval2 = makeMockEvaluation(101n);
        const result = await proc.deploy(addr, 101n, eval2);

        expect(result).toBeNull();
    });

    it('TX deploying 2 sub-contracts, both unique, both succeed', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);
        const addr1 = uniqueAddress();
        const addr2 = uniqueAddress();

        const { deployed } = await proc.processTx([addr1, addr2], 100n);

        expect(deployed).toEqual([addr1, addr2]);
        expect(db.size()).toBe(2);
    });
});

describe('revertBlock cleans up stale data', () => {
    it('deploy + revert + re-deploy succeeds', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);
        const addr = uniqueAddress();

        await proc.processTx([addr], 100n);
        expect(db.has(addr.toHex())).toBe(true);

        proc.revertBlock(100n);
        expect(db.has(addr.toHex())).toBe(false);
        expect(proc.contractCache.size).toBe(0);

        const { deployed } = await proc.processTx([addr], 100n);
        expect(deployed).toEqual([addr]);
    });

    it('revert only deletes contracts at or above the reverted height', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);

        const addrA = uniqueAddress();
        const addrB = uniqueAddress();

        await proc.processTx([addrA], 99n);
        proc.finalizeBlock();

        await proc.processTx([addrB], 100n);

        proc.revertBlock(100n);

        expect(db.has(addrA.toHex())).toBe(true);
        expect(db.has(addrB.toHex())).toBe(false);
    });

    it('revert clears cache so same-block false positives are gone', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);
        const addr = uniqueAddress();

        await proc.processTx([addr], 100n);
        expect(proc.contractCache.has(addr)).toBe(true);

        proc.revertBlock(100n);
        expect(proc.contractCache.has(addr)).toBe(false);
    });
});

describe('Reorg simulation: 10 TXs each deploying 2 sub-contracts', () => {
    it('process block, reorg, re-process,  all 20 contracts deploy correctly both times', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);
        const BLOCK = 500n;

        const txBatches: Address[][] = [];
        for (let tx = 0; tx < 10; tx++) {
            txBatches.push([uniqueAddress(), uniqueAddress()]);
        }
        const allAddresses = txBatches.flat();

        for (const batch of txBatches) {
            const { deployed } = await proc.processTx(batch, BLOCK);
            expect(deployed.length).toBe(2);
        }

        expect(db.size()).toBe(20);
        expect(proc.contractCache.size).toBe(20);
        for (const addr of allAddresses) {
            expect(db.has(addr.toHex())).toBe(true);
        }

        proc.revertBlock(BLOCK);

        expect(db.size()).toBe(0);
        expect(proc.contractCache.size).toBe(0);
        for (const addr of allAddresses) {
            expect(db.has(addr.toHex())).toBe(false);
        }

        for (const batch of txBatches) {
            const { deployed } = await proc.processTx(batch, BLOCK);
            expect(deployed.length).toBe(2);
        }

        expect(db.size()).toBe(20);
        for (const addr of allAddresses) {
            expect(db.has(addr.toHex())).toBe(true);
        }
    });

    it('reorg does not affect contracts from prior committed blocks', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);

        const priorAddresses: Address[] = [];
        for (let i = 0; i < 5; i++) {
            const addr = uniqueAddress();
            priorAddresses.push(addr);
            await proc.processTx([addr], 499n);
        }
        proc.finalizeBlock();
        expect(db.size()).toBe(5);

        const txBatches: Address[][] = [];
        for (let tx = 0; tx < 10; tx++) {
            txBatches.push([uniqueAddress(), uniqueAddress()]);
        }
        for (const batch of txBatches) {
            await proc.processTx(batch, 500n);
        }
        expect(db.size()).toBe(25);

        proc.revertBlock(500n);

        expect(db.size()).toBe(5);
        for (const addr of priorAddresses) {
            expect(db.has(addr.toHex())).toBe(true);
        }

        for (const batch of txBatches) {
            const { deployed } = await proc.processTx(batch, 500n);
            expect(deployed.length).toBe(2);
        }
        expect(db.size()).toBe(25);
    });

    it('deep reorg: revert 3 blocks, re-process all, state is consistent', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);

        const blockContracts: Map<bigint, Address[][]> = new Map();
        for (let block = 100n; block <= 102n; block++) {
            const txBatches: Address[][] = [];
            for (let tx = 0; tx < 3; tx++) {
                txBatches.push([uniqueAddress(), uniqueAddress()]);
            }
            blockContracts.set(block, txBatches);

            for (const batch of txBatches) {
                await proc.processTx(batch, block);
            }
            proc.finalizeBlock();
        }

        expect(db.size()).toBe(18);

        proc.revertBlock(100n);
        expect(db.size()).toBe(0);

        for (let block = 100n; block <= 102n; block++) {
            const txBatches = blockContracts.get(block)!;
            for (const batch of txBatches) {
                const { deployed } = await proc.processTx(batch, block);
                expect(deployed.length).toBe(2);
            }
            proc.finalizeBlock();
        }

        expect(db.size()).toBe(18);
    });

    it('partial reorg: revert only the tip, earlier blocks intact', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);

        const block100Addrs: Address[] = [];
        for (let i = 0; i < 2; i++) {
            const batch = [uniqueAddress(), uniqueAddress()];
            block100Addrs.push(...batch);
            await proc.processTx(batch, 100n);
        }
        proc.finalizeBlock();

        const block101Addrs: Address[] = [];
        for (let i = 0; i < 2; i++) {
            const batch = [uniqueAddress(), uniqueAddress()];
            block101Addrs.push(...batch);
            await proc.processTx(batch, 101n);
        }
        proc.finalizeBlock();

        const block102Addrs: Address[] = [];
        for (let i = 0; i < 2; i++) {
            const batch = [uniqueAddress(), uniqueAddress()];
            block102Addrs.push(...batch);
            await proc.processTx(batch, 102n);
        }

        expect(db.size()).toBe(12);

        proc.revertBlock(102n);
        expect(db.size()).toBe(8);

        for (const addr of [...block100Addrs, ...block101Addrs]) {
            expect(db.has(addr.toHex())).toBe(true);
        }
        for (const addr of block102Addrs) {
            expect(db.has(addr.toHex())).toBe(false);
        }

        for (let i = 0; i < 2; i++) {
            const batch = [block102Addrs[i * 2], block102Addrs[i * 2 + 1]];
            const { deployed } = await proc.processTx(batch, 102n);
            expect(deployed.length).toBe(2);
        }
        expect(db.size()).toBe(12);
    });
});

describe('Reorg loop: repeated reorg cycles', () => {
    it('10 cycles of process-revert on the same block with identical TXs', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);
        const BLOCK = 200n;

        const txBatches: Address[][] = [];
        for (let tx = 0; tx < 10; tx++) {
            txBatches.push([uniqueAddress(), uniqueAddress()]);
        }
        const allAddresses = txBatches.flat();

        for (let cycle = 0; cycle < 10; cycle++) {
            for (const batch of txBatches) {
                const { deployed } = await proc.processTx(batch, BLOCK);
                expect(deployed.length).toBe(2);
            }
            expect(db.size()).toBe(20);

            proc.revertBlock(BLOCK);
            expect(db.size()).toBe(0);
            expect(proc.contractCache.size).toBe(0);
        }

        for (const batch of txBatches) {
            const { deployed } = await proc.processTx(batch, BLOCK);
            expect(deployed.length).toBe(2);
        }
        expect(db.size()).toBe(20);
        for (const addr of allAddresses) {
            expect(db.has(addr.toHex())).toBe(true);
        }
    });

    it('alternating blocks with reorgs: block N processed, reorged, N+1 processed, reorged...', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);

        const allDeployed: Address[] = [];

        for (let block = 100n; block < 110n; block++) {
            const batch = [uniqueAddress(), uniqueAddress()];

            const { deployed } = await proc.processTx(batch, block);
            expect(deployed.length).toBe(2);
            proc.finalizeBlock();

            allDeployed.push(...batch);
        }

        expect(db.size()).toBe(20);

        proc.revertBlock(105n);
        expect(db.size()).toBe(10); // blocks 100-104 survive

        for (const addr of allDeployed.slice(0, 10)) {
            expect(db.has(addr.toHex())).toBe(true);
        }
        for (const addr of allDeployed.slice(10)) {
            expect(db.has(addr.toHex())).toBe(false);
        }

        const newAddresses: Address[] = [];
        for (let block = 105n; block < 110n; block++) {
            const batch = [uniqueAddress(), uniqueAddress()];
            newAddresses.push(...batch);
            const { deployed } = await proc.processTx(batch, block);
            expect(deployed.length).toBe(2);
            proc.finalizeBlock();
        }

        expect(db.size()).toBe(20);
        for (const addr of newAddresses) {
            expect(db.has(addr.toHex())).toBe(true);
        }
    });
});

describe('Stale data defense-in-depth (the -1n fix)', () => {
    it('stale record at current height: revert cleans it, but even without revert -1n saves us', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);
        const addr = uniqueAddress();
        const BLOCK = 300n;

        await proc.processTx([addr], BLOCK);
        expect(db.has(addr.toHex())).toBe(true);

        proc.contractCache.clear(); // cache is cleared (finally block runs)

        const eval2 = makeMockEvaluation(BLOCK);
        const result = await proc.deploy(addr, BLOCK, eval2);

        expect(result).toBe(addr); // deployment succeeds despite stale data
    });

    it('stale records at current+1 and current+2 from 2-block reorg are invisible', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);

        const addr1 = uniqueAddress();
        const addr2 = uniqueAddress();

        db.setContractAt(addr1.toHex(), 501n, makeContractInfo(501n, addr1));
        db.setContractAt(addr2.toHex(), 502n, makeContractInfo(502n, addr2));

        const eval1 = makeMockEvaluation(500n);
        const r1 = await proc.deploy(addr1, 500n, eval1);
        const r2 = await proc.deploy(addr2, 500n, eval1);

        expect(r1).toBe(addr1);
        expect(r2).toBe(addr2);
    });

    it('contract at blockHeight = currentBlock - 1 IS found (correctly blocking duplicate)', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);
        const addr = uniqueAddress();

        db.setContractAt(addr.toHex(), 499n, makeContractInfo(499n, addr));

        const eval1 = makeMockEvaluation(500n);
        const result = await proc.deploy(addr, 500n, eval1);

        expect(result).toBeNull();
    });
});

describe('Complex: factory contracts deploying sub-contracts across reorgs', () => {
    it('10 factory TXs each deploying 2 sub-contracts, reorg mid-block, re-process', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);
        const BLOCK = 8460n;

        const factories: { factory: Address; children: [Address, Address] }[] = [];
        for (let i = 0; i < 10; i++) {
            factories.push({
                factory: uniqueAddress(),
                children: [uniqueAddress(), uniqueAddress()],
            });
        }

        for (let i = 0; i < 5; i++) {
            const { deployed } = await proc.processTx(factories[i].children, BLOCK);
            expect(deployed.length).toBe(2);
        }

        expect(db.size()).toBe(10);

        proc.revertBlock(BLOCK);
        expect(db.size()).toBe(0);

        for (let i = 0; i < 10; i++) {
            const { deployed } = await proc.processTx(factories[i].children, BLOCK);
            expect(deployed.length).toBe(2);
        }

        expect(db.size()).toBe(20);
        for (const f of factories) {
            for (const child of f.children) {
                expect(db.has(child.toHex())).toBe(true);
            }
        }
    });

    it('factory deploys child that was already deployed in a prior committed block', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);
        const childAddr = uniqueAddress();

        await proc.processTx([childAddr], 100n);
        proc.finalizeBlock();

        const eval2 = makeMockEvaluation(101n);
        const result = await proc.deploy(childAddr, 101n, eval2);

        expect(result).toBeNull();
    });

    it('factory TX deploys 2 children, one collides with earlier TX in same block', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);
        const sharedAddr = uniqueAddress();
        const uniqueAddr = uniqueAddress();

        await proc.processTx([sharedAddr], 500n);

        const eval2 = makeMockEvaluation(500n);
        const r1 = await proc.deploy(uniqueAddr, 500n, eval2);
        expect(r1).toBe(uniqueAddr);

        await expect(proc.deploy(sharedAddr, 500n, eval2)).rejects.toThrow(
            'Contract already deployed. (cache)',
        );
    });

    it('massive reorg: 5 blocks x 10 TXs x 2 contracts = 100, revert all, re-process', async () => {
        const db = new InMemoryContractDB();
        const proc = new BlockProcessor(db);

        const blockData: Map<bigint, Address[][]> = new Map();

        for (let block = 200n; block < 205n; block++) {
            const txBatches: Address[][] = [];
            for (let tx = 0; tx < 10; tx++) {
                txBatches.push([uniqueAddress(), uniqueAddress()]);
            }
            blockData.set(block, txBatches);

            for (const batch of txBatches) {
                await proc.processTx(batch, block);
            }
            proc.finalizeBlock();
        }

        expect(db.size()).toBe(100);

        proc.revertBlock(200n);
        expect(db.size()).toBe(0);

        for (let block = 200n; block < 205n; block++) {
            const txBatches = blockData.get(block)!;
            for (const batch of txBatches) {
                const { deployed } = await proc.processTx(batch, block);
                expect(deployed.length).toBe(2);
            }
            proc.finalizeBlock();
        }

        expect(db.size()).toBe(100);

        for (const [, txBatches] of blockData) {
            for (const batch of txBatches) {
                for (const addr of batch) {
                    expect(db.has(addr.toHex())).toBe(true);
                }
            }
        }
    });
});
