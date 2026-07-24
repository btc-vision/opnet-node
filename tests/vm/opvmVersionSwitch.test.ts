import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConfig } = vi.hoisted(() => ({
    mockConfig: {
        OP_NET: {
            REINDEX: false,
            REINDEX_FROM_BLOCK: 0,
        },
        BITCOIN: {
            NETWORK: 'mainnet',
            CHAIN_ID: 0,
        },
    },
}));

vi.mock('../../src/src/config/Config.js', () => ({ Config: mockConfig }));

import { OPNetConsensus } from '../../src/src/poc/configurations/OPNetConsensus.js';
import { OPVMVersion } from '../../src/src/vm/rust/versions/OPVMVersion.js';
import { BitcoinNetwork } from '../../src/src/config/network/BitcoinNetwork.js';
import { ChainIds } from '../../src/src/config/enums/ChainIds.js';

const MAINNET_ACTIVATION = 959_317n;
const TESTNET_ACTIVATION = 139_693n;

function useNetwork(network: BitcoinNetwork, chainId: ChainIds = ChainIds.Bitcoin): void {
    mockConfig.BITCOIN.NETWORK = network;
    mockConfig.BITCOIN.CHAIN_ID = chainId;
}

describe('op-vm version switch', () => {
    beforeAll(() => {
        OPNetConsensus.setBlockHeight(1n);
    });

    beforeEach(() => {
        useNetwork(BitcoinNetwork.mainnet);
    });

    describe('mainnet', () => {
        it('replays every block below the activation height on 1.0.0', () => {
            for (const height of [0n, 1n, 500_000n, MAINNET_ACTIVATION - 1n]) {
                expect(OPNetConsensus.opVmVersionForBlock(height)).toBe(OPVMVersion.Legacy);
            }
        });

        it('runs the activation height itself on the current runtime', () => {
            expect(OPNetConsensus.opVmVersionForBlock(MAINNET_ACTIVATION)).toBe(OPVMVersion.Latest);
        });

        it('runs every block above the activation height on the current runtime', () => {
            for (const height of [MAINNET_ACTIVATION + 1n, 1_000_000n, 2_000_000n]) {
                expect(OPNetConsensus.opVmVersionForBlock(height)).toBe(OPVMVersion.Latest);
            }
        });

        // The boundary is the whole point: 959316 committed its state under
        // 1.0.0 and 959317 is the first block of the new rules. Off by one here
        // means every node that gets it wrong forks.
        it('switches exactly between 959316 and 959317', () => {
            expect(OPNetConsensus.opVmVersionForBlock(959_316n)).toBe(OPVMVersion.Legacy);
            expect(OPNetConsensus.opVmVersionForBlock(959_317n)).toBe(OPVMVersion.Latest);
        });
    });

    describe('testnet', () => {
        beforeEach(() => {
            useNetwork(BitcoinNetwork.testnet);
        });

        it('switches exactly between 139692 and 139693', () => {
            expect(OPNetConsensus.opVmVersionForBlock(139_692n)).toBe(OPVMVersion.Legacy);
            expect(OPNetConsensus.opVmVersionForBlock(139_693n)).toBe(OPVMVersion.Latest);
        });

        it('replays genesis on 1.0.0', () => {
            expect(OPNetConsensus.opVmVersionForBlock(0n)).toBe(OPVMVersion.Legacy);
        });

        it('does not use the mainnet activation height', () => {
            expect(OPNetConsensus.opVmVersionForBlock(TESTNET_ACTIVATION)).toBe(OPVMVersion.Latest);
            expect(OPNetConsensus.opVmVersionForBlock(MAINNET_ACTIVATION)).toBe(OPVMVersion.Latest);
        });
    });

    describe('regtest', () => {
        beforeEach(() => {
            useNetwork(BitcoinNetwork.regtest);
        });

        it('never uses 1.0.0, including at genesis', () => {
            for (const height of [0n, 1n, 100n, 959_316n, 1_000_000n]) {
                expect(OPNetConsensus.opVmVersionForBlock(height)).toBe(OPVMVersion.Latest);
            }
        });
    });

    describe('networks with no configured activation height', () => {
        it('uses the current runtime rather than falling back to 1.0.0', () => {
            useNetwork(BitcoinNetwork.signet);
            expect(OPNetConsensus.opVmVersionForBlock(0n)).toBe(OPVMVersion.Latest);

            useNetwork(BitcoinNetwork.testnet4);
            expect(OPNetConsensus.opVmVersionForBlock(0n)).toBe(OPVMVersion.Latest);
        });

        it('uses the current runtime for chains other than Bitcoin', () => {
            useNetwork(BitcoinNetwork.mainnet, ChainIds.Fractal);
            expect(OPNetConsensus.opVmVersionForBlock(0n)).toBe(OPVMVersion.Latest);
            expect(OPNetConsensus.opVmVersionForBlock(959_316n)).toBe(OPVMVersion.Latest);
        });
    });

    it('matches the heights committed in RoswellConsensus', () => {
        const activation =
            OPNetConsensus.consensus.CONTRACTS.OP_VM_LATEST_ACTIVATION[ChainIds.Bitcoin];

        expect(activation?.[BitcoinNetwork.mainnet]).toBe(MAINNET_ACTIVATION);
        expect(activation?.[BitcoinNetwork.testnet]).toBe(TESTNET_ACTIVATION);
        expect(activation?.[BitcoinNetwork.regtest]).toBe(0n);
    });
});
