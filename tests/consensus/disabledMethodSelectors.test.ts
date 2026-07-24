import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/src/config/Config.js', () => ({
    Config: {
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

import { OPNetConsensus } from '../../src/src/poc/configurations/OPNetConsensus.js';
import { ChainIds } from '../../src/src/config/enums/ChainIds.js';
import { BitcoinNetwork } from '../../src/src/config/network/BitcoinNetwork.js';

const METHOD_DISABLED_ERROR = 'Method disabled';
const APPROVE_BY_SIGNATURE_SELECTOR = 0x459c188c;
const INCREASE_ALLOWANCE_BY_SIGNATURE_SELECTOR = 0x37778848;
const DECREASE_ALLOWANCE_BY_SIGNATURE_SELECTOR = 0x5d6ee26c;
const UNKNOWN_SELECTOR = 0xffffffff;

/**
 * Read the activation height out of the consensus config rather than repeating
 * it. A hardcoded copy previously drifted one block ahead of
 * DISABLE_OP20_SIGNATURE_ALLOWANCE_BLOCK, so "one block before activation" was
 * actually the activation block itself and the test failed. The concrete height
 * is still pinned by its own assertion below, so a consensus change has to be
 * deliberate.
 */
function activationBlockFor(selector: number): bigint {
    const rules =
        OPNetConsensus.consensus.CONTRACTS.DISABLED_METHODS[ChainIds.Bitcoin]?.[
            BitcoinNetwork.mainnet
        ];

    const rule = rules?.find((r) => r.SELECTORS.includes(selector));
    if (!rule) {
        throw new Error(`No disabled-method rule configured for selector ${selector}`);
    }

    return rule.ENABLE_AT_BLOCK;
}

// Resolved in beforeAll: OPNetConsensus.consensus throws until setBlockHeight()
// has selected a consensus, so this cannot be computed at module scope.
let DISABLED_AT_BLOCK: bigint;

function calldataWithSelector(selector: number): Uint8Array {
    const calldata = new Uint8Array(8);
    const view = new DataView(calldata.buffer);
    view.setUint32(0, selector, false);

    calldata[4] = 0xaa;
    calldata[5] = 0xbb;
    calldata[6] = 0xcc;
    calldata[7] = 0xdd;

    return calldata;
}

describe('disabled consensus method selectors', () => {
    beforeAll(() => {
        OPNetConsensus.setBlockHeight(1n);

        DISABLED_AT_BLOCK = activationBlockFor(APPROVE_BY_SIGNATURE_SELECTOR);
    });

    it('activates at the height committed in RoswellConsensus', () => {
        expect(DISABLED_AT_BLOCK).toBe(956_297n);
    });

    it('does not disable configured selectors before the activation block', () => {
        const selectors = [
            APPROVE_BY_SIGNATURE_SELECTOR,
            INCREASE_ALLOWANCE_BY_SIGNATURE_SELECTOR,
            DECREASE_ALLOWANCE_BY_SIGNATURE_SELECTOR,
        ];

        for (const selector of selectors) {
            expect(
                OPNetConsensus.disabledContractMethodError(
                    DISABLED_AT_BLOCK - 1n,
                    calldataWithSelector(selector),
                ),
            ).toBeUndefined();
        }
    });

    it('disables configured selectors at the activation block', () => {
        const selectors = [
            APPROVE_BY_SIGNATURE_SELECTOR,
            INCREASE_ALLOWANCE_BY_SIGNATURE_SELECTOR,
            DECREASE_ALLOWANCE_BY_SIGNATURE_SELECTOR,
        ];

        for (const selector of selectors) {
            expect(
                OPNetConsensus.disabledContractMethodError(
                    DISABLED_AT_BLOCK,
                    calldataWithSelector(selector),
                ),
            ).toBe(METHOD_DISABLED_ERROR);
        }
    });

    it('disables configured selectors after the activation block', () => {
        expect(
            OPNetConsensus.disabledContractMethodError(
                DISABLED_AT_BLOCK + 1n,
                calldataWithSelector(APPROVE_BY_SIGNATURE_SELECTOR),
            ),
        ).toBe(METHOD_DISABLED_ERROR);
    });

    it('does not disable unknown selectors or short calldata', () => {
        expect(
            OPNetConsensus.disabledContractMethodError(
                DISABLED_AT_BLOCK,
                calldataWithSelector(UNKNOWN_SELECTOR),
            ),
        ).toBeUndefined();

        expect(
            OPNetConsensus.disabledContractMethodError(
                DISABLED_AT_BLOCK,
                Uint8Array.from([0x45, 0x9c, 0x18]),
            ),
        ).toBeUndefined();
    });

    it('reads selectors from calldata views with nonzero byte offsets', () => {
        const padded = new Uint8Array(10);
        const view = new DataView(padded.buffer);
        view.setUint32(2, APPROVE_BY_SIGNATURE_SELECTOR, false);

        expect(
            OPNetConsensus.disabledContractMethodError(DISABLED_AT_BLOCK, padded.subarray(2)),
        ).toBe(METHOD_DISABLED_ERROR);
    });
});
