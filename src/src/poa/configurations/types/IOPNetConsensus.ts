import { Consensus } from '../consensus/Consensus.js';

export interface IOPNetConsensus<T extends Consensus> {
    /** Information about the consensus */
    // The consensus type.
    readonly CONSENSUS: T;

    // The consensus name.
    readonly CONSENSUS_NAME: string;

    /** General consensus properties */
    // The block height at which this consensus was enabled.
    readonly ENABLED_AT_BLOCK: bigint;

    /** Networking */
    // Define the maximum size of a transaction that can be broadcasted.
    readonly MAXIMUM_TRANSACTION_BROADCAST_SIZE: number;

    // Define the maximum size of a PSBT transaction that can be broadcasted.
    readonly PSBT_MAXIMUM_TRANSACTION_BROADCAST_SIZE: number;

    /** Vaults related properties */
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
    [key in Consensus]: IOPNetConsensus<key>;
};
