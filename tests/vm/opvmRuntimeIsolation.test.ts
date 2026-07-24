import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/src/config/Config.js', () => ({
    Config: {
        DEV: {
            ENABLE_CONTRACT_DEBUG: false,
        },
    },
}));

import { createLegacyRuntime } from '../../src/src/vm/rust/versions/LegacyOPVM.js';
import { createLatestRuntime } from '../../src/src/vm/rust/versions/LatestOPVM.js';
import { OPVMVersion } from '../../src/src/vm/rust/versions/OPVMVersion.js';
import { RustContractBinding } from '../../src/src/vm/rust/RustContractBindings.js';

const legacy = createLegacyRuntime();
const latest = createLatestRuntime();

function stubBinding(id: bigint): RustContractBinding {
    const unused = () => Promise.resolve(new Uint8Array());

    return {
        id,
        loadMLDSA: unused,
        load: unused,
        store: unused,
        tLoad: unused,
        tStore: unused,
        call: unused,
        deployContractAtAddress: unused,
        updateFromAddress: unused,
        log: () => {},
        emit: () => {},
        inputs: unused,
        outputs: unused,
        accountType: () => Promise.resolve({ accountType: 0, isAddressWarm: false }),
        blockHash: () => Promise.resolve({ blockHash: Buffer.alloc(32), isBlockWarm: false }),
    };
}

describe('op-vm runtime isolation', () => {
    afterAll(() => {
        legacy.purge();
        latest.purge();
    });

    it('loads both native modules in the same process', () => {
        expect(legacy.contractManager).toBeDefined();
        expect(latest.contractManager).toBeDefined();
    });

    it('reports its own version', () => {
        expect(legacy.version).toBe(OPVMVersion.Legacy);
        expect(latest.version).toBe(OPVMVersion.Latest);
    });

    it('holds genuinely distinct managers', () => {
        expect(legacy.contractManager).not.toBe(latest.contractManager);
    });

    // The reason each runtime owns its binding table. Both managers count ids
    // from their own zero, so a shared table would route one contract's storage
    // callbacks into the other runtime's evaluation.
    it('hands out colliding contract ids across versions', () => {
        const legacyId = legacy.contractManager.reserveId();
        const latestId = latest.contractManager.reserveId();

        expect(legacyId).toBe(latestId);
    });

    it('keeps binding tables separate for the same id', () => {
        const id = 42n;
        const legacyBinding = stubBinding(id);

        legacy.registerBinding(legacyBinding);

        expect(() => latest.removeBinding(id)).not.toThrow();

        legacy.removeBinding(id);
    });

    it('does not create a runtime until it is asked for', () => {
        const fresh = createLegacyRuntime();

        expect(fresh.initialized).toBe(false);

        expect(fresh.contractManager).toBeDefined();
        expect(fresh.initialized).toBe(true);

        fresh.purge();
    });
});
