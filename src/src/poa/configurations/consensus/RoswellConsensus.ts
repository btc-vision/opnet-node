import { IOPNetConsensus } from '../types/IOPNetConsensus.js';
import { Consensus } from './Consensus.js';

export const RoswellConsensus: IOPNetConsensus<Consensus.Roswell> = {
    /** Information about the consensus */
    CONSENSUS: Consensus.Roswell,
    CONSENSUS_NAME: 'Roswell',

    /** General consensus properties */
    // The block height at which this consensus was enabled.
    ENABLED_AT_BLOCK: 0n,

    /** Networking */
    MAXIMUM_TRANSACTION_BROADCAST_SIZE: 800000, // Cap to 800k bytes.

    PSBT_MAXIMUM_TRANSACTION_BROADCAST_SIZE: 1000000, // Cap to 1M bytes.

    /** Vaults related properties */
    // Defines the minimum amount that can be consolidated in a single transaction.
    VAULT_MINIMUM_AMOUNT: 200000n,

    // Defines the requested minimum acceptance for joining UTXOs when an unwrap is being done.
    // If the consolidate output going back to the vault is lower than this amount, the transaction will be rejected.
    // User must pay for the consolidation, this help the network by having fewer UTXOs.
    VAULT_NETWORK_CONSOLIDATION_ACCEPTANCE: 200000n * 2n,

    // Everytime an user wrap bitcoin, he prepays the fees for the consolidation at a maximum fee rate of the following determined value.
    // If the fees are lower, the user will be refunded the difference.
    // If the fees are higher, the user must pay the difference.
    UNWRAP_CONSOLIDATION_PREPAID_FEES: 250n,

    // Equivalent to 56500 satoshis, calculated from UNWRAP_CONSOLIDATION_PREPAID_FEES.
    UNWRAP_CONSOLIDATION_PREPAID_FEES_SAT: 56500n,
};
