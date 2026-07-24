import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConfig } = vi.hoisted(() => ({
    mockConfig: {
        OP_NET: { REINDEX: false, REINDEX_FROM_BLOCK: 0 },
        BITCOIN: { NETWORK: 'regtest', CHAIN_ID: 0 },
        DEV: { ENABLE_CONTRACT_DEBUG: false },
    },
}));

vi.mock('../../src/src/config/Config.js', () => ({ Config: mockConfig }));

import { Address, AddressMap, MLDSASecurityLevel } from '@btc-vision/transaction';
import { OPNetConsensus } from '../../src/src/poc/configurations/OPNetConsensus.js';
import { VMManager } from '../../src/src/vm/VMManager.js';
import { IMLDSAPublicKey } from '../../src/src/db/interfaces/IMLDSAPublicKey.js';

/**
 * Exercises the real guard methods on VMManager.
 *
 * VMManager's constructor builds storage, a network converter and a block-header
 * validator, none of which these code paths touch, so the instance is created
 * from the prototype with only the collaborators the guards actually use
 * injected. The methods under test are the genuine implementations.
 */

// A real compressed secp256k1 point (the generator). The guards run EC tweaking
// on the legacy key, so this cannot be arbitrary bytes.
const LEGACY_PUBKEY = Uint8Array.from(
    Buffer.from('0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798', 'hex'),
);

// The contract drained on mainnet.
const VICTIM_CONTRACT = Uint8Array.from(
    Buffer.from('ab99e31ebb30b8e596d5be1bd1e501ee8e7b7e5ec9dc7ee880f4937b0c929dcb', 'hex'),
);

const INNOCENT_HASH = Uint8Array.from(
    Buffer.from('1111111111111111111111111111111111111111111111111111111111111111', 'hex'),
);

const HEIGHT = 1_000_000n;

interface Harness {
    manager: VMManager;
    contracts: Set<string>;
    exists: {
        hashedExists: boolean;
        legacyExists: boolean;
        sameId: boolean;
        publicKeyExists: boolean;
        level: MLDSASecurityLevel;
    };
}

function makeHarness(height: bigint = HEIGHT): Harness {
    const contracts = new Set<string>();
    const exists = {
        hashedExists: false,
        legacyExists: false,
        sameId: false,
        publicKeyExists: false,
        level: MLDSASecurityLevel.LEVEL2,
    };

    const manager = Object.create(VMManager.prototype) as VMManager;
    const injected = manager as unknown as Record<string, unknown>;

    injected.vmBitcoinBlock = { height };
    injected.vmStorage = {
        getContractAt: (address: string) =>
            Promise.resolve(contracts.has(address.toLowerCase()) ? { address } : undefined),
        mldsaPublicKeyExists: () => Promise.resolve(exists),
    };
    injected.mldsaToStore = new AddressMap();
    injected.mldsaToStoreLegacy = new AddressMap();
    injected.mldsaToStoreByHash = new AddressMap();

    return { manager, contracts, exists };
}

function linkRequest(hashedPublicKey: Uint8Array, publicKey: Uint8Array | null = null): IMLDSAPublicKey {
    return {
        level: MLDSASecurityLevel.LEVEL2,
        hashedPublicKey,
        legacyPublicKey: LEGACY_PUBKEY,
        tweakedPublicKey: new Uint8Array(32),
        publicKey,
        insertedBlockHeight: HEIGHT,
        exposedBlockHeight: null,
    };
}

function markDeployed(h: Harness, hashedPublicKey: Uint8Array): void {
    h.contracts.add(new Address(hashedPublicKey).toHex().toLowerCase());
}

describe('ML-DSA identity binding guard (VMManager)', () => {
    beforeAll(() => {
        OPNetConsensus.setBlockHeight(1n);
    });

    beforeEach(() => {
        // regtest enforces from genesis, so the guard is active by default here.
        mockConfig.BITCOIN.NETWORK = 'regtest';
        mockConfig.BITCOIN.CHAIN_ID = 0;
    });

    describe('rule 2 — may not claim a deployed contract address', () => {
        it('rejects the exact mainnet attack: linking a contract address', async () => {
            const h = makeHarness();
            markDeployed(h, VICTIM_CONTRACT);

            await expect(
                h.manager.addMLDSAInfoToStore(linkRequest(VICTIM_CONTRACT)),
            ).rejects.toThrow(/may not claim a deployed contract address/);
        });

        it('rejects it on the reveal path too', async () => {
            const h = makeHarness();
            markDeployed(h, VICTIM_CONTRACT);

            // A real ML-DSA key whose hash happens to be a contract address must
            // not slip through just because a signature was verified upstream.
            await expect(
                h.manager.exposeMLDSAPublicKey(linkRequest(VICTIM_CONTRACT, new Uint8Array(1312))),
            ).rejects.toThrow(/may not claim a deployed contract address/);
        });

        it('does not reject a hash that is not a contract', async () => {
            const h = makeHarness();
            markDeployed(h, VICTIM_CONTRACT);

            await expect(
                h.manager.addMLDSAInfoToStore(linkRequest(INNOCENT_HASH)),
            ).rejects.not.toThrow(/deployed contract address/);
        });
    });

    describe('rule 1 — a new link must reveal the ML-DSA key', () => {
        it('rejects a new unrevealed link', async () => {
            const h = makeHarness();

            await expect(
                h.manager.addMLDSAInfoToStore(linkRequest(INNOCENT_HASH)),
            ).rejects.toThrow(/must reveal the public key and a valid ML-DSA signature/);
        });

        it('allows an ALREADY linked key to re-send (existing wallets keep working)', async () => {
            const h = makeHarness();
            h.exists.hashedExists = true;
            h.exists.legacyExists = true;
            h.exists.sameId = true;

            await expect(
                h.manager.addMLDSAInfoToStore(linkRequest(INNOCENT_HASH)),
            ).resolves.toBeUndefined();
        });

        it('allows a new link on the reveal path', async () => {
            const h = makeHarness();

            await expect(
                h.manager.exposeMLDSAPublicKey(linkRequest(INNOCENT_HASH, new Uint8Array(1312))),
            ).resolves.toBeUndefined();
        });
    });

    describe('consensus gating', () => {
        it('does not enforce either rule below the activation height', async () => {
            // mainnet activates at 959_500; 900_000 is before the fork.
            mockConfig.BITCOIN.NETWORK = 'mainnet';

            const h = makeHarness(900_000n);
            markDeployed(h, VICTIM_CONTRACT);

            const request = {
                ...linkRequest(VICTIM_CONTRACT),
                insertedBlockHeight: 900_000n,
            };

            // Pre-fork behaviour is preserved exactly, otherwise replaying
            // history would diverge.
            await expect(h.manager.addMLDSAInfoToStore(request)).resolves.toBeUndefined();
        });

        it('enforces both rules at and above the activation height', async () => {
            mockConfig.BITCOIN.NETWORK = 'mainnet';

            const h = makeHarness(959_500n);
            markDeployed(h, VICTIM_CONTRACT);

            const request = {
                ...linkRequest(VICTIM_CONTRACT),
                insertedBlockHeight: 959_500n,
            };

            await expect(h.manager.addMLDSAInfoToStore(request)).rejects.toThrow(
                /may not claim a deployed contract address/,
            );
        });
    });
});
