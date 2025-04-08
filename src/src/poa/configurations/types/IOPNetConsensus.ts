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

        // Allow legacy? Hybrid contract address are supported in this version.
        readonly ALLOW_LEGACY: boolean;
    };

    readonly POW: {
        readonly PREIMAGE_LENGTH: number;
    };

    /** Contracts related rules */
    readonly CONTRACTS: {
        /** The maximum size of a calldata in bytes. */
        readonly MAXIMUM_CONTRACT_SIZE_COMPRESSED: number;

        /** The maximum size of calldata in bytes. */
        readonly MAXIMUM_CALLDATA_SIZE_COMPRESSED: number;
    };

    readonly COMPRESSION: {
        MAX_DECOMPRESSED_SIZE: number;
    };

    /** Transactions related properties */
    readonly GAS: {
        readonly COST: {
            readonly COLD_STORAGE_LOAD: bigint;
        };

        /** How many sat of gas is equal to 1 sat of priority */
        readonly GAS_PENALTY_FACTOR: bigint;

        /** Target block gas limit */
        readonly TARGET_GAS: bigint;

        /** Smooth out gas increase when equal to gas target. */
        readonly SMOOTH_OUT_GAS_INCREASE: bigint;

        /**
         * Maximum theoretical upper limit, all transactions after this limit will revert for being out of gas.
         * Can overflow up to the value set to TRANSACTION_MAX_GAS.
         */
        readonly MAX_THEORETICAL_GAS: bigint;

        /** Max gas per transactions */
        readonly TRANSACTION_MAX_GAS: bigint;

        /** btc_call maximum gas */
        readonly EMULATION_MAX_GAS: bigint;

        /** Panic gas cost */
        readonly PANIC_GAS_COST: bigint;

        /** Converts satoshi to BTC */
        readonly SAT_TO_GAS_RATIO: bigint;

        /** Minimum base gas, sat/gas unit */
        readonly MIN_BASE_GAS: number;

        /** Smoothing factor for EMA */
        readonly SMOOTHING_FACTOR: number;

        /** Adjustment factor when G_t > G_targetBlock */
        readonly ALPHA1: number;

        /** Adjustment factor when G_t <= G_targetBlock */
        readonly ALPHA2: number;

        /** Target utilization ratio */
        readonly U_TARGET: number;
    };

    readonly TRANSACTIONS: {
        readonly EVENTS: {
            /** The maximum size of an event in bytes */
            readonly MAXIMUM_EVENT_LENGTH: number;

            /** The maximum size of all events combined  */
            readonly MAXIMUM_TOTAL_EVENT_LENGTH: number;

            /** The maximum length of an event name */
            readonly MAXIMUM_EVENT_NAME_LENGTH: number;
        };

        /** The maximum size of a receipt in bytes */
        readonly MAXIMUM_RECEIPT_LENGTH: number;

        /** The maximum amount of contract a transaction can deploy */
        readonly MAXIMUM_DEPLOYMENT_DEPTH: number;

        /** The maximum amount of calls possible in a transaction */
        readonly MAXIMUM_CALL_DEPTH: number;

        /** The cost of a byte in gas */
        readonly STORAGE_COST_PER_BYTE: bigint;

        /** The maximum inputs utxos to forward to a contract */
        readonly MAXIMUM_INPUTS: number;

        /** Check for reentrancy */
        readonly REENTRANCY_GUARD: boolean;

        /** The maximum outputs utxos to forward to a contract */
        readonly MAXIMUM_OUTPUTS: number;

        /** Skip proof validation for execution before transaction */
        readonly SKIP_PROOF_VALIDATION_FOR_EXECUTION_BEFORE_TRANSACTION: boolean;
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
}

export type IOPNetConsensusObj = {
    [key in Consensus]?: IOPNetConsensus<key>;
};
