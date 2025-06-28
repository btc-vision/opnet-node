import { OPNetConsensus } from '../poa/configurations/OPNetConsensus.js';
import { GasTracker } from '../vm/runtime/GasTracker.js';
import { BlockGasPredictor } from '../blockchain-indexer/processor/gas/BlockGasPredictor.js';

export function calculateMaxGas(
    isSimulation: boolean,
    gasInSat: bigint,
    baseGas: bigint,
    TRANSACTION_MAX_GAS: bigint,
): bigint {
    const gas: bigint = isSimulation
        ? TRANSACTION_MAX_GAS
        : GasTracker.convertSatToGas(
              gasInSat,
              TRANSACTION_MAX_GAS,
              OPNetConsensus.consensus.GAS.SAT_TO_GAS_RATIO,
          );

    const gasToScale = BlockGasPredictor.toBaseBigInt(gas);
    return gasToScale / baseGas; // Round down.
}
