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
});
