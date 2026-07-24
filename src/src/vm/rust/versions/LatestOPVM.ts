import { ContractManager, HardForkRequest } from '@btc-vision/op-vm';
import { InstantiateArgs, OPVMBackend, OPVMHostFunctions, OPVMRuntime } from '../../OPVMRuntime.js';
import { OPVMVersion } from './OPVMVersion.js';
import { OPNetConsensus } from '../../../poc/configurations/OPNetConsensus.js';
import { Consensus } from '../../../poc/configurations/consensus/Consensus.js';

/**
 * Adapter for the current @btc-vision/op-vm build, used from
 * CONTRACTS.OP_VM_LATEST_ACTIVATION upward.
 */

/**
 * Consensus has 27 members, HardForkRequest has 2. Map explicitly and throw on
 * anything op-vm does not know about.
 *
 * The previous call site passed `OPNetConsensus.consensus.CONSENSUS as unknown
 * as HardForkRequest`, which only worked because Roswell/Rachel happen to share
 * the numbering. From Kecksburg (2) onward that cast would have handed op-vm an
 * out-of-range discriminant with no error at the boundary. Failing loudly at the
 * consensus switch is the correct behaviour: it means op-vm needs a matching
 * release before that consensus can activate.
 */
function toHardFork(consensus: Consensus): HardForkRequest {
    switch (consensus) {
        case Consensus.Roswell:
            return HardForkRequest.Roswell;
        case Consensus.Rachel:
            return HardForkRequest.Rachel;
        default:
            throw new Error(
                `op-vm has no hard fork mapping for consensus ${Consensus[consensus] ?? consensus}`,
            );
    }
}

function createLatestBackend(host: OPVMHostFunctions): OPVMBackend {
    const manager = new ContractManager(
        16, // max idling runtime
        host.load,
        host.store,
        host.call,
        host.deployContractAtAddress,
        host.updateFromAddress,
        host.log,
        host.emit,
        host.inputs,
        host.outputs,
        host.accountType,
        host.blockHash,
        host.loadMLDSA,
    );

    return {
        manager,
        // 1.1.0 takes the hard fork descriptor between `network` and
        // `isDebugMode`. Resolved per call, because the active consensus can
        // change while the process is running.
        instantiate: (args: InstantiateArgs): void => {
            manager.instantiate(
                args.reservedId,
                args.address,
                args.bytecode,
                args.gasUsed,
                args.gasMax,
                args.memoryPagesUsed,
                args.network,
                toHardFork(OPNetConsensus.consensus.CONSENSUS),
                args.isDebugMode,
                false, // bypassCache
                OPNetConsensus.consensusRules.asBigInt(), // consensusFlags
            );
        },
    };
}

export function createLatestRuntime(): OPVMRuntime {
    return new OPVMRuntime(OPVMVersion.Latest, createLatestBackend);
}
