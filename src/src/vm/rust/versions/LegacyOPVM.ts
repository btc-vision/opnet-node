import {
    BitcoinNetworkRequest as LegacyBitcoinNetworkRequest,
    ContractManager as LegacyContractManager,
} from '@btc-vision/op-vm-legacy';
import { BitcoinNetworkRequest } from '@btc-vision/op-vm';
import {
    InstantiateArgs,
    OPVMBackend,
    OPVMHostFunctions,
    OPVMRuntime,
} from '../../OPVMRuntime.js';
import { OPVMVersion } from './OPVMVersion.js';

/**
 * Adapter for the pinned @btc-vision/op-vm 1.0.0 build.
 *
 * This file is the ONLY place that may import op-vm-legacy. It exists so the
 * blocks that 1.0.0 originally executed keep being replayed by 1.0.0 forever,
 * bit for bit.
 */

/**
 * TypeScript enums are nominal, so the two packages' BitcoinNetworkRequest are
 * distinct types even while their members are identical. Map explicitly rather
 * than cast, so a member added on one side becomes a compile error here instead
 * of a silently wrong network at runtime.
 */
function toLegacyNetwork(network: BitcoinNetworkRequest): LegacyBitcoinNetworkRequest {
    switch (network) {
        case BitcoinNetworkRequest.Mainnet:
            return LegacyBitcoinNetworkRequest.Mainnet;
        case BitcoinNetworkRequest.Testnet:
            return LegacyBitcoinNetworkRequest.Testnet;
        case BitcoinNetworkRequest.Regtest:
            return LegacyBitcoinNetworkRequest.Regtest;
        case BitcoinNetworkRequest.OPNetTestnet:
            return LegacyBitcoinNetworkRequest.OPNetTestnet;
        default:
            throw new Error(`Unknown network ${network}`);
    }
}

function createLegacyBackend(host: OPVMHostFunctions): OPVMBackend {
    const manager = new LegacyContractManager(
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
        // 1.0.0 instantiate takes no hard fork descriptor. Do not add one: these
        // blocks predate it, and passing anything extra changes execution.
        instantiate: (args: InstantiateArgs): void => {
            manager.instantiate(
                args.reservedId,
                args.address,
                args.bytecode,
                args.gasUsed,
                args.gasMax,
                args.memoryPagesUsed,
                toLegacyNetwork(args.network),
                args.isDebugMode,
            );
        },
    };
}

export function createLegacyRuntime(): OPVMRuntime {
    return new OPVMRuntime(OPVMVersion.Legacy, createLegacyBackend);
}
