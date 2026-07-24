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

const DISABLED_AT_BLOCK = 956_298n;
const METHOD_DISABLED_ERROR = 'Method disabled';
const APPROVE_BY_SIGNATURE_SELECTOR = 0x459c188c;
const INCREASE_ALLOWANCE_BY_SIGNATURE_SELECTOR = 0x37778848;
const DECREASE_ALLOWANCE_BY_SIGNATURE_SELECTOR = 0x5d6ee26c;
const UNKNOWN_SELECTOR = 0xffffffff;

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
