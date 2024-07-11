import { Consensus } from '../consensus/Consensus.js';

export interface IOPNetConsensus<T extends Consensus> {
    /** Information about the consensus */
    // The consensus type.
    readonly CONSENSUS: T;

    // The consensus name.
    readonly CONSENSUS_NAME: string;

    readonly GENERIC: {
        /** General consensus properties */
        // The block height at which this consensus was enabled.
        readonly ENABLED_AT_BLOCK: bigint;

        // The next consensus.
        readonly NEXT_CONSENSUS: Consensus;

        // The block height at which the next consensus will be enabled.
        readonly NEXT_CONSENSUS_BLOCK: bigint;

        // Is this node updated to the next consensus?
        readonly IS_READY_FOR_NEXT_CONSENSUS: boolean;
    };

    readonly TRANSACTIONS: {
        /** Transactions related properties */
        MAX_GAS: bigint;

        /** btc_call maximum gas */
        EMULATION_MAX_GAS: bigint;

        /** Converts satoshi to BTC */
        SAT_TO_GAS_RATIO: bigint;

        /** The maximum size of a receipt in bytes */
        MAXIMUM_RECEIPT_LENGTH: number;

        /** The maximum size of an event in bytes */
        MAXIMUM_EVENT_LENGTH: number;

        /** The maximum amount of contract a transaction can deploy */
        MAXIMUM_DEPLOYMENT_DEPTH: number;

        /** The maximum amount of calls possible in a transaction */
        MAXIMUM_CALL_DEPTH: number;

        /** The cost of a byte in gas */
        STORAGE_COST_PER_BYTE: bigint;

        /** Skip proof validation for execution before transaction */
        SKIP_PROOF_VALIDATION_FOR_EXECUTION_BEFORE_TRANSACTION: boolean;
    };

    readonly NETWORK: {
        /** Networking */
        // Define the maximum size of a transaction that can be broadcasted.
        readonly MAXIMUM_TRANSACTION_BROADCAST_SIZE: number;

        // Define the maximum size of a PSBT transaction that can be broadcasted.
        readonly PSBT_MAXIMUM_TRANSACTION_BROADCAST_SIZE: number;
    };

    readonly PSBT: {
        // Define the minimum fee rate that must be paid for a PSBT to be accepted.
        readonly MINIMAL_PSBT_ACCEPTANCE_FEE_VB_PER_SAT: bigint;
    };

    readonly VAULTS: {
        /** Vaults related properties */
        readonly VAULT_MINIMAL_FEE_ADDITION_VB_PER_SAT: bigint;

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

        // The maximum number of UTXOs that can be consolidated in a single transaction.
        readonly MAXIMUM_CONSOLIDATION_UTXOS: number;
    };
}

export type IOPNetConsensusObj = {
    [key in Consensus]?: IOPNetConsensus<key>;
};
