import { OPVMRuntime } from './OPVMRuntime.js';
import { OPVMVersion } from './rust/versions/OPVMVersion.js';
import { createLegacyRuntime } from './rust/versions/LegacyOPVM.js';
import { createLatestRuntime } from './rust/versions/LatestOPVM.js';
import { OPNetConsensus } from '../poc/configurations/OPNetConsensus.js';

/**
 * Holds one {@link OPVMRuntime} per op-vm build and picks between them by block
 * height.
 *
 * Runtimes are created on first use, so a node that never replays pre-fork
 * blocks (regtest, or a mainnet node past the activation height that never
 * reorgs that deep) never loads the 1.0.0 native module at all.
 */
class OPVMRegistry {
    private readonly runtimes: Map<OPVMVersion, OPVMRuntime> = new Map<OPVMVersion, OPVMRuntime>();

    /** The runtime that must execute `blockHeight`, per consensus. */
    public runtimeForBlock(blockHeight: bigint): OPVMRuntime {
        return this.runtimeFor(OPNetConsensus.opVmVersionForBlock(blockHeight));
    }

    public runtimeFor(version: OPVMVersion): OPVMRuntime {
        const existing = this.runtimes.get(version);
        if (existing) {
            return existing;
        }

        const created =
            version === OPVMVersion.Legacy ? createLegacyRuntime() : createLatestRuntime();

        this.runtimes.set(version, created);

        return created;
    }

    /** Versions this process has actually loaded. */
    public get loadedVersions(): OPVMVersion[] {
        return [...this.runtimes.keys()];
    }

    public purgeCached(): void {
        for (const runtime of this.runtimes.values()) {
            runtime.purgeCached();
        }
    }

    public purge(): void {
        for (const runtime of this.runtimes.values()) {
            runtime.purge();
        }
    }
}

export const Blockchain = new OPVMRegistry();
