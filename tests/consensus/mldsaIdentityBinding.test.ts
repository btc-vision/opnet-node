import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPNetConsensus } from '../../src/src/poc/configurations/OPNetConsensus.js';
import { ChainIds } from '../../src/src/config/enums/ChainIds.js';
import { BitcoinNetwork } from '../../src/src/config/network/BitcoinNetwork.js';

const { mockConfig } = vi.hoisted(() => ({
    mockConfig: {
        OP_NET: { REINDEX: false, REINDEX_FROM_BLOCK: 0 },
        BITCOIN: { NETWORK: 'mainnet', CHAIN_ID: 0 },
    },
}));

vi.mock('../../src/src/config/Config.js', () => ({ Config: mockConfig }));

function useNetwork(network: BitcoinNetwork, chainId: ChainIds = ChainIds.Bitcoin): void {
    mockConfig.BITCOIN.NETWORK = network;
    mockConfig.BITCOIN.CHAIN_ID = chainId;
}

/**
 * Guard against re-opening the ML-DSA identity-forgery hole.
 *
 * An OPNet identity is the raw 32 bytes of `hashedPublicKey`, and a link
 * request's Schnorr signature only proves ownership of the Bitcoin key being
 * linked. Contract addresses share that 32-byte space, so without this guard a
 * link request could claim a contract's address and then transact as it.
 * Observed on mainnet at block 957938 against contract
 * 0xab99e31ebb30b8e596d5be1bd1e501ee8e7b7e5ec9dc7ee880f4937b0c929dcb.
 */
describe('ML-DSA identity binding guard', () => {
    beforeAll(() => {
        OPNetConsensus.setBlockHeight(1n);
    });

    beforeEach(() => {
        useNetwork(BitcoinNetwork.mainnet);
    });

    it('is active at and above the mainnet activation height', () => {
        expect(OPNetConsensus.enforcesMLDSAIdentityBinding(959_500n)).toBe(true);
        expect(OPNetConsensus.enforcesMLDSAIdentityBinding(1_000_000n)).toBe(true);
    });

    it('switches exactly at the configured boundary', () => {
        const activation =
            OPNetConsensus.consensus.CONTRACTS.MLDSA_IDENTITY_BINDING_GUARD[ChainIds.Bitcoin]?.[
                BitcoinNetwork.mainnet
            ];

        if (activation === undefined) {
            throw new Error('mainnet activation height must be configured');
        }

        expect(OPNetConsensus.enforcesMLDSAIdentityBinding(activation - 1n)).toBe(false);
        expect(OPNetConsensus.enforcesMLDSAIdentityBinding(activation)).toBe(true);
    });

    it('uses the testnet height on testnet', () => {
        useNetwork(BitcoinNetwork.testnet);

        expect(OPNetConsensus.enforcesMLDSAIdentityBinding(139_999n)).toBe(false);
        expect(OPNetConsensus.enforcesMLDSAIdentityBinding(140_000n)).toBe(true);
    });

    it('is active from genesis on regtest', () => {
        useNetwork(BitcoinNetwork.regtest);

        expect(OPNetConsensus.enforcesMLDSAIdentityBinding(0n)).toBe(true);
    });

    // Unlike OP_VM_LATEST_ACTIVATION, an unconfigured network must FAIL CLOSED.
    // A chain with no pre-fork history never depended on the broken behaviour,
    // and defaulting a new network to "exploitable" is never the safe choice.
    it('fails closed for networks with no configured height', () => {
        useNetwork(BitcoinNetwork.signet);
        expect(OPNetConsensus.enforcesMLDSAIdentityBinding(0n)).toBe(true);

        useNetwork(BitcoinNetwork.mainnet, ChainIds.Fractal);
        expect(OPNetConsensus.enforcesMLDSAIdentityBinding(0n)).toBe(true);
    });

    /**
     * v1.1.1 moved this height to 957_378, BELOW the exploit block, so replaying
     * history rejects the poisoned link. Moving it forward again would revalidate
     * block 957_938 and fork away from every released node.
     */
    it('pins the released mainnet height — moving it revalidates the exploit', () => {
        const activation =
            OPNetConsensus.consensus.CONTRACTS.MLDSA_IDENTITY_BINDING_GUARD[ChainIds.Bitcoin]?.[
                BitcoinNetwork.mainnet
            ];

        expect(activation).toBe(957_378n);
        expect(OPNetConsensus.enforcesMLDSAIdentityBinding(957_938n)).toBe(true);
    });
});

/**
 * The reveal requirement, split out of MLDSA_IDENTITY_BINDING_GUARD so the two
 * rules can move independently.
 *
 * It is the only rule that stops an attacker adopting a 32-byte identity they
 * hold no preimage for -- including one that already holds a balance but has
 * never been linked -- so it fails CLOSED, and its heights must keep reproducing
 * what v1.1.2 already enforced.
 */
describe('ML-DSA reveal requirement', () => {
    beforeAll(() => {
        OPNetConsensus.setBlockHeight(1n);
    });

    beforeEach(() => {
        useNetwork(BitcoinNetwork.mainnet);
    });

    // The split must be behaviour-preserving: same switch, two names.
    it('reproduces the guard heights exactly on every network', () => {
        const guard =
            OPNetConsensus.consensus.CONTRACTS.MLDSA_IDENTITY_BINDING_GUARD[ChainIds.Bitcoin];
        const reveal =
            OPNetConsensus.consensus.CONTRACTS.MLDSA_REVEAL_REQUIRED_ON_NEW_LINK[ChainIds.Bitcoin];

        expect(reveal).toStrictEqual(guard);
    });

    // Sunset == activation on the test chains, i.e. never enforced there.
    it('is never enforced on testnet', () => {
        useNetwork(BitcoinNetwork.testnet);

        expect(OPNetConsensus.requiresMLDSARevealOnNewLink(139_999n)).toBe(false);
        expect(OPNetConsensus.requiresMLDSARevealOnNewLink(140_000n)).toBe(false);
        expect(OPNetConsensus.requiresMLDSARevealOnNewLink(10_000_000n)).toBe(false);
    });

    it('is never enforced on regtest', () => {
        useNetwork(BitcoinNetwork.regtest);

        expect(OPNetConsensus.requiresMLDSARevealOnNewLink(0n)).toBe(false);
        expect(OPNetConsensus.requiresMLDSARevealOnNewLink(10_000_000n)).toBe(false);
    });

    /**
     * The rule is retired, but the window it WAS enforced over must stay intact:
     * 957_378..960_082 on mainnet replays exactly as v1.1.2 executed it. Rewinding
     * the activation instead of sunsetting would re-validate every link rejected in
     * that window and fork from every released node.
     */
    it('still enforces over the historical mainnet window', () => {
        expect(OPNetConsensus.requiresMLDSARevealOnNewLink(957_377n)).toBe(false);
        expect(OPNetConsensus.requiresMLDSARevealOnNewLink(957_378n)).toBe(true);
        expect(OPNetConsensus.requiresMLDSARevealOnNewLink(960_082n)).toBe(true);
    });

    it('stops enforcing at the mainnet sunset', () => {
        expect(OPNetConsensus.requiresMLDSARevealOnNewLink(960_083n)).toBe(false);
        expect(OPNetConsensus.requiresMLDSARevealOnNewLink(1_000_000n)).toBe(false);
    });

    // A sunset behind the tip would retroactively re-validate rejected links.
    it('sunsets at or after the height it activated on mainnet', () => {
        const activation =
            OPNetConsensus.consensus.CONTRACTS.MLDSA_REVEAL_REQUIRED_ON_NEW_LINK[
                ChainIds.Bitcoin
            ]?.[BitcoinNetwork.mainnet];
        const sunset =
            OPNetConsensus.consensus.CONTRACTS.MLDSA_REVEAL_SUNSET[ChainIds.Bitcoin]?.[
                BitcoinNetwork.mainnet
            ];

        expect(activation).toBeDefined();
        expect(sunset).toBeDefined();
        expect(sunset as bigint).toBeGreaterThanOrEqual(activation as bigint);
    });

    it('fails closed for networks with no configured height', () => {
        useNetwork(BitcoinNetwork.signet);
        expect(OPNetConsensus.requiresMLDSARevealOnNewLink(0n)).toBe(true);

        useNetwork(BitcoinNetwork.mainnet, ChainIds.Fractal);
        expect(OPNetConsensus.requiresMLDSARevealOnNewLink(0n)).toBe(true);
    });
});

/**
 * The deploy-side mirror: a contract may not be deployed onto an address that is
 * already an ML-DSA identity.
 *
 * A NEW rule, so unlike the two above it activates AHEAD of the tip rather than
 * at the already-passed guard height.
 */
describe('ML-DSA deploy identity guard', () => {
    beforeAll(() => {
        OPNetConsensus.setBlockHeight(1n);
    });

    beforeEach(() => {
        useNetwork(BitcoinNetwork.mainnet);
    });

    it('switches exactly at the mainnet boundary', () => {
        expect(OPNetConsensus.enforcesMLDSADeployIdentityGuard(960_059n)).toBe(false);
        expect(OPNetConsensus.enforcesMLDSADeployIdentityGuard(960_060n)).toBe(true);
    });

    // A new rule applied at an already-passed height would retroactively
    // invalidate historical deployments.
    it('activates after the guard it mirrors on mainnet', () => {
        const guard =
            OPNetConsensus.consensus.CONTRACTS.MLDSA_IDENTITY_BINDING_GUARD[ChainIds.Bitcoin]?.[
                BitcoinNetwork.mainnet
            ];
        const deploy =
            OPNetConsensus.consensus.CONTRACTS.MLDSA_DEPLOY_IDENTITY_GUARD[ChainIds.Bitcoin]?.[
                BitcoinNetwork.mainnet
            ];

        expect(guard).toBeDefined();
        expect(deploy).toBeDefined();
        expect(deploy as bigint).toBeGreaterThan(guard as bigint);
    });

    it('fails closed for networks with no configured height', () => {
        useNetwork(BitcoinNetwork.signet);
        expect(OPNetConsensus.enforcesMLDSADeployIdentityGuard(0n)).toBe(true);

        useNetwork(BitcoinNetwork.mainnet, ChainIds.Fractal);
        expect(OPNetConsensus.enforcesMLDSADeployIdentityGuard(0n)).toBe(true);
    });
});

/**
 * One Bitcoin key, one identity — keyed on the parity-independent tweaked key.
 *
 * The 33-byte legacy key's leading parity byte is attacker-chosen and is not
 * covered by the tapscript commitment, so uniqueness keyed on it lets one key
 * claim two identities and makes `caller` node-dependent. Also a NEW rule, so it
 * activates ahead of the tip.
 */
describe('ML-DSA tweaked identity uniqueness', () => {
    beforeAll(() => {
        OPNetConsensus.setBlockHeight(1n);
    });

    beforeEach(() => {
        useNetwork(BitcoinNetwork.mainnet);
    });

    it('switches exactly at the mainnet boundary', () => {
        expect(OPNetConsensus.enforcesMLDSATweakedIdentityUniqueness(960_059n)).toBe(false);
        expect(OPNetConsensus.enforcesMLDSATweakedIdentityUniqueness(960_060n)).toBe(true);
    });

    it('activates after the reveal rule on mainnet', () => {
        const reveal =
            OPNetConsensus.consensus.CONTRACTS.MLDSA_REVEAL_REQUIRED_ON_NEW_LINK[
                ChainIds.Bitcoin
            ]?.[BitcoinNetwork.mainnet];
        const uniqueness =
            OPNetConsensus.consensus.CONTRACTS.MLDSA_TWEAKED_IDENTITY_UNIQUENESS[
                ChainIds.Bitcoin
            ]?.[BitcoinNetwork.mainnet];

        expect(reveal).toBeDefined();
        expect(uniqueness).toBeDefined();
        expect(uniqueness as bigint).toBeGreaterThan(reveal as bigint);
    });

    // Both new rules ship as one fork.
    it('shares the deploy guard heights', () => {
        const deploy =
            OPNetConsensus.consensus.CONTRACTS.MLDSA_DEPLOY_IDENTITY_GUARD[ChainIds.Bitcoin];
        const uniqueness =
            OPNetConsensus.consensus.CONTRACTS.MLDSA_TWEAKED_IDENTITY_UNIQUENESS[ChainIds.Bitcoin];

        expect(uniqueness).toStrictEqual(deploy);
    });

    it('fails closed for networks with no configured height', () => {
        useNetwork(BitcoinNetwork.signet);
        expect(OPNetConsensus.enforcesMLDSATweakedIdentityUniqueness(0n)).toBe(true);

        useNetwork(BitcoinNetwork.mainnet, ChainIds.Fractal);
        expect(OPNetConsensus.enforcesMLDSATweakedIdentityUniqueness(0n)).toBe(true);
    });
});
