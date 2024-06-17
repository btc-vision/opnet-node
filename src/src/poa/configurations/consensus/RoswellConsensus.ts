import { IOPNetConsensus } from '../types/IOPNetConsensus.js';

export const RoswellConsensus: IOPNetConsensus = {
    ENABLED_AT_BLOCK: 0n,
    VAULT_MINIMUM_AMOUNT: 200000n,
    VAULT_NETWORK_CONSOLIDATION_ACCEPTANCE: 200000n * 2n,
    UNWRAP_CONSOLIDATION_PREPAID_FEES: 250n,

    // Equivalent to 56500 satoshis, calculated from UNWRAP_CONSOLIDATION_PREPAID_FEES.
    UNWRAP_CONSOLIDATION_PREPAID_FEES_SAT: 56500n,
};
