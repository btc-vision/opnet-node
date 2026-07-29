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

// The parity-independent tweaked key both 0x02||X and 0x03||X collapse to.
const TWEAKED_KEY = Uint8Array.from(
    Buffer.from('da4710964f7852695de2da025290e24af6d8c281de5a0b902b7135fd9fd74d21', 'hex'),
);

const OTHER_HASH = Uint8Array.from(
    Buffer.from('2222222222222222222222222222222222222222222222222222222222222222', 'hex'),
);

const HEIGHT = 1_000_000n;

const hex = (bytes: Uint8Array): string =>
    Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

interface Harness {
    manager: VMManager;
    contracts: Set<string>;
    identities: Set<string>;
    /** tweakedPublicKey hex -> hashedPublicKey already bound to it */
    boundByTweaked: Map<string, Uint8Array>;
    pending: AddressMap<Uint8Array>;
    assertNotClaimedIdentity: (contractAddress: Address) => Promise<void>;
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
    const identities = new Set<string>();
    const boundByTweaked = new Map<string, Uint8Array>();
    const exists = {
        hashedExists: false,
        legacyExists: false,
        sameId: false,
        publicKeyExists: false,
        level: MLDSASecurityLevel.LEVEL2,
    };

    const manager = Object.create(VMManager.prototype) as VMManager;
    const injected = manager as unknown as Record<string, unknown>;
    const pending: AddressMap<Uint8Array> = new AddressMap();

    injected.vmBitcoinBlock = { height };
    injected.vmStorage = {
        getContractAt: (address: string) =>
            Promise.resolve(contracts.has(address.toLowerCase()) ? { address } : undefined),
        mldsaPublicKeyExists: () => Promise.resolve(exists),
        getMLDSAPublicKeyFromHash: (key: Uint8Array) =>
            Promise.resolve(identities.has(hex(key)) ? { hashedPublicKey: key } : null),
        getMLDSAByLegacy: (tweaked: Uint8Array) => {
            const bound = boundByTweaked.get(hex(tweaked));
            return Promise.resolve(bound ? { hashedPublicKey: bound } : null);
        },
    };
    injected.mldsaToStore = new AddressMap();
    injected.mldsaToStoreLegacy = new AddressMap();
    injected.mldsaToStoreByHash = pending;

    const guard = injected.assertNotClaimedIdentity as (a: Address) => Promise<void>;

    return {
        manager,
        contracts,
        identities,
        boundByTweaked,
        pending,
        exists,
        assertNotClaimedIdentity: (contractAddress: Address) => guard.call(manager, contractAddress),
    };
}

function linkRequest(hashedPublicKey: Uint8Array, publicKey: Uint8Array | null = null): IMLDSAPublicKey {
    return {
        level: MLDSASecurityLevel.LEVEL2,
        hashedPublicKey,
        legacyPublicKey: LEGACY_PUBKEY,
        tweakedPublicKey: TWEAKED_KEY,
        publicKey,
        insertedBlockHeight: HEIGHT,
        exposedBlockHeight: null,
    };
}

function markDeployed(h: Harness, hashedPublicKey: Uint8Array): void {
    h.contracts.add(new Address(hashedPublicKey).toHex().toLowerCase());
}

// A real ML-DSA-44 public key is 1312 bytes. Only the length matters here: the
// signature itself is verified upstream in SharedInteractionParameters, not by
// the VMManager guards under test.
const REVEALED_KEY = new Uint8Array(1312);

describe('ML-DSA identity binding guard (VMManager)', () => {
    beforeAll(() => {
        OPNetConsensus.setBlockHeight(1n);
    });

    beforeEach(() => {
        // regtest enforces the CONTRACT-ADDRESS guard from genesis, so rule 2 is
        // active by default here. The reveal requirement is sunset on regtest.
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
                h.manager.exposeMLDSAPublicKey(linkRequest(VICTIM_CONTRACT, REVEALED_KEY)),
            ).rejects.toThrow(/may not claim a deployed contract address/);
        });

        it('does not reject a hash that is not a contract', async () => {
            const h = makeHarness();
            markDeployed(h, VICTIM_CONTRACT);

            // Via the reveal path, so the assertion is about rule 2 alone.
            await expect(
                h.manager.exposeMLDSAPublicKey(linkRequest(INNOCENT_HASH, REVEALED_KEY)),
            ).resolves.toBeUndefined();
        });
    });

    describe('rule 1 — a new link must reveal the ML-DSA key', () => {
        // RETIRED. Not revealing is the protocol's documented default and the
        // requirement rejected every pre-1.8.9 client's first link. The
        // contract-address guard is what stopped the exploit and stays in force.
        it('allows a new unrevealed link on regtest (never enforced there)', async () => {
            const h = makeHarness();

            await expect(
                h.manager.addMLDSAInfoToStore(linkRequest(INNOCENT_HASH)),
            ).resolves.toBeUndefined();
        });

        // The window it WAS enforced over must replay unchanged.
        it('still rejects inside the historical mainnet window', async () => {
            mockConfig.BITCOIN.NETWORK = 'mainnet';

            const h = makeHarness(957_378n);
            const request = { ...linkRequest(INNOCENT_HASH), insertedBlockHeight: 957_378n };

            await expect(h.manager.addMLDSAInfoToStore(request)).rejects.toThrow(
                /must reveal the public key and a valid ML-DSA signature/,
            );
        });

        it('allows it from the mainnet sunset onward', async () => {
            mockConfig.BITCOIN.NETWORK = 'mainnet';

            const h = makeHarness(960_083n);
            const request = { ...linkRequest(INNOCENT_HASH), insertedBlockHeight: 960_083n };

            await expect(h.manager.addMLDSAInfoToStore(request)).resolves.toBeUndefined();
        });

        // Fails CLOSED, like the contract-address guard: a chain with no pre-fork
        // history never depended on the loose behaviour, and defaulting a new
        // network to "squattable" is never the safe choice.
        it('enforces on a network with no configured height', async () => {
            mockConfig.BITCOIN.NETWORK = 'signet';

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
                h.manager.exposeMLDSAPublicKey(linkRequest(INNOCENT_HASH, REVEALED_KEY)),
            ).resolves.toBeUndefined();
        });
    });

    /**
     * Rule 2 only asks whether the claimed hash is a contract AT LINK TIME, so
     * reversing the order walks straight past it: claim the address of a contract
     * you have not deployed yet, then deploy it. The deployer picks the salt, so
     * the address is known before the link goes out and no race is involved.
     */
    describe('reverse ordering — may not deploy onto a claimed identity', () => {
        it('rejects deploying to an address linked in an earlier block', async () => {
            const h = makeHarness();
            h.identities.add(hex(INNOCENT_HASH));

            await expect(h.assertNotClaimedIdentity(new Address(INNOCENT_HASH))).rejects.toThrow(
                /already linked to an ML-DSA identity/,
            );
        });

        it('rejects deploying to an address claimed earlier in the SAME block', async () => {
            const h = makeHarness();
            // Not yet flushed to storage; only the pending map knows about it.
            h.pending.set(new Address(INNOCENT_HASH), LEGACY_PUBKEY);

            await expect(h.assertNotClaimedIdentity(new Address(INNOCENT_HASH))).rejects.toThrow(
                /already linked to an ML-DSA identity/,
            );
        });

        it('allows deploying to an unclaimed address', async () => {
            const h = makeHarness();
            h.identities.add(hex(VICTIM_CONTRACT));

            await expect(
                h.assertNotClaimedIdentity(new Address(INNOCENT_HASH)),
            ).resolves.toBeUndefined();
        });

        it('is gated by its own activation height', async () => {
            mockConfig.BITCOIN.NETWORK = 'mainnet';

            const before = makeHarness(960_059n);
            before.identities.add(hex(INNOCENT_HASH));
            await expect(
                before.assertNotClaimedIdentity(new Address(INNOCENT_HASH)),
            ).resolves.toBeUndefined();

            const after = makeHarness(960_060n);
            after.identities.add(hex(INNOCENT_HASH));
            await expect(
                after.assertNotClaimedIdentity(new Address(INNOCENT_HASH)),
            ).rejects.toThrow(/already linked to an ML-DSA identity/);
        });
    });

    /**
     * The parity byte of the 33-byte legacy key is attacker-chosen and is not
     * covered by the tapscript's OP_HASH256 commitment, so 0x02||X and 0x03||X
     * spend with the same signature, are both valid points, and tweak to the same
     * output key. Uniqueness keyed on the 33-byte value therefore lets ONE Bitcoin
     * key claim TWO identities in two blocks, after which identity resolution is
     * node-dependent — a chain split.
     */
    describe('one Bitcoin key, one identity (parity-byte hole)', () => {
        it('rejects a second identity for a tweaked key already bound', async () => {
            const h = makeHarness();
            // First link, e.g. via 0x02||X, already committed in an earlier block.
            h.boundByTweaked.set(hex(TWEAKED_KEY), INNOCENT_HASH);

            // Second link from the SAME Bitcoin key via 0x03||X, different identity.
            await expect(
                h.manager.exposeMLDSAPublicKey(linkRequest(OTHER_HASH, REVEALED_KEY)),
            ).rejects.toThrow(/already linked to a different ML-DSA identity/);
        });

        it('rejects it on the unrevealed path too', async () => {
            const h = makeHarness();
            h.boundByTweaked.set(hex(TWEAKED_KEY), INNOCENT_HASH);

            await expect(h.manager.addMLDSAInfoToStore(linkRequest(OTHER_HASH))).rejects.toThrow(
                /already linked to a different ML-DSA identity/,
            );
        });

        // Revealing is no defence: the attacker holds both ML-DSA keypairs.
        it('rejects even with a valid reveal', async () => {
            const h = makeHarness();
            h.boundByTweaked.set(hex(TWEAKED_KEY), INNOCENT_HASH);
            h.exists.publicKeyExists = true;

            await expect(
                h.manager.exposeMLDSAPublicKey(linkRequest(OTHER_HASH, REVEALED_KEY)),
            ).rejects.toThrow(/already linked to a different ML-DSA identity/);
        });

        it('allows re-linking the SAME identity', async () => {
            const h = makeHarness();
            h.boundByTweaked.set(hex(TWEAKED_KEY), INNOCENT_HASH);
            h.exists.hashedExists = true;
            h.exists.legacyExists = true;
            h.exists.sameId = true;

            await expect(
                h.manager.addMLDSAInfoToStore(linkRequest(INNOCENT_HASH)),
            ).resolves.toBeUndefined();
        });

        it('allows a first link when the tweaked key is unbound', async () => {
            const h = makeHarness();

            await expect(
                h.manager.exposeMLDSAPublicKey(linkRequest(INNOCENT_HASH, REVEALED_KEY)),
            ).resolves.toBeUndefined();
        });

        it('is gated by its own activation height', async () => {
            mockConfig.BITCOIN.NETWORK = 'mainnet';

            const before = makeHarness(960_059n);
            before.boundByTweaked.set(hex(TWEAKED_KEY), INNOCENT_HASH);
            await expect(
                before.manager.exposeMLDSAPublicKey({
                    ...linkRequest(OTHER_HASH, REVEALED_KEY),
                    insertedBlockHeight: 960_059n,
                }),
            ).resolves.toBeUndefined();

            const after = makeHarness(960_060n);
            after.boundByTweaked.set(hex(TWEAKED_KEY), INNOCENT_HASH);
            await expect(
                after.manager.exposeMLDSAPublicKey({
                    ...linkRequest(OTHER_HASH, REVEALED_KEY),
                    insertedBlockHeight: 960_060n,
                }),
            ).rejects.toThrow(/already linked to a different ML-DSA identity/);
        });
    });

    describe('consensus gating', () => {
        it('does not enforce the contract-address guard below the activation height', async () => {
            // mainnet activates at 957_378; 900_000 is before the fork.
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

        it('enforces the contract-address guard at and above the activation height', async () => {
            mockConfig.BITCOIN.NETWORK = 'mainnet';

            const h = makeHarness(957_378n);
            markDeployed(h, VICTIM_CONTRACT);

            const request = {
                ...linkRequest(VICTIM_CONTRACT),
                insertedBlockHeight: 957_378n,
            };

            await expect(h.manager.addMLDSAInfoToStore(request)).rejects.toThrow(
                /may not claim a deployed contract address/,
            );
        });
    });
});
