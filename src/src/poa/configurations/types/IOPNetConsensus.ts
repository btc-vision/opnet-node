import { Consensus } from '../consensus/Consensus.js';

export interface IOPNetConsensus {
    // The block height at which this consensus was enabled.
    readonly ENABLED_AT_BLOCK: bigint;

    /** WBTC vaults */
    // Defines the minimum amount that can be consolidated in a single transaction.
    readonly VAULT_MINIMUM_AMOUNT: bigint;

    // Defines the requested minimum acceptance for joining UTXOs when an unwrap is being done.
    // If the consolidate output going back to the vault is lower than this amount, the transaction will be rejected.
    // User must pay for the consolidation, this help the network by having fewer UTXOs.
    readonly VAULT_NETWORK_CONSOLIDATION_ACCEPTANCE: bigint;

    // Everytime an user wrap bitcoin, he prepays the fees for the consolidation at a maximum fee rate of the following determined value.
    // If the fees are lower, the user will be refunded the difference.
    // If the fees are higher, the user must pay the difference.
    readonly UNWRAP_CONSOLIDATION_PREPAID_FEES: bigint;

    // The maximum fee rate for the consolidation.
    readonly UNWRAP_CONSOLIDATION_PREPAID_FEES_SAT: bigint;
}

export type IOPNetConsensusObj = {
    [key in Consensus]: IOPNetConsensus;
};
