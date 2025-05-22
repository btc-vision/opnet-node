import { IOPNetConsensus } from '../types/IOPNetConsensus.js';
import { Consensus } from './Consensus.js';
import { BitcoinNetwork } from '../../../config/network/BitcoinNetwork.js';
import {
    SPECIAL_CONTRACTS_ROSWELL_MAINNET,
    SPECIAL_CONTRACTS_ROSWELL_REGTEST,
    SPECIAL_CONTRACTS_ROSWELL_TESTNET,
} from './roswell/SpecialContractsRoswell.js';
import { ChainIds } from '../../../config/enums/ChainIds.js';

export const RoswellConsensus: IOPNetConsensus<Consensus.Roswell> = {
    /** Information about the consensus */
    CONSENSUS: Consensus.Roswell,
    CONSENSUS_NAME: 'Roswell',

    OPNET_ENABLED: {
        [ChainIds.Bitcoin]: {
            [BitcoinNetwork.mainnet]: {
                ENABLED: false,
                BLOCK: 0n,
            },
            [BitcoinNetwork.testnet]: {
                ENABLED: true,
                BLOCK: 0n,
            },
            [BitcoinNetwork.regtest]: {
                ENABLED: true,
                BLOCK: 0n,
            },
        },
    },

    GENERIC: {
        /** General consensus properties */
        // The block height at which this consensus was enabled.
        ENABLED_AT_BLOCK: -1n,

        // The next consensus.
        NEXT_CONSENSUS: Consensus.Rachel,

        // The block height at which the next consensus will be enabled.
        NEXT_CONSENSUS_BLOCK: 100_000_000_000n, //1008n,

        // Is this node updated to the next consensus?
        IS_READY_FOR_NEXT_CONSENSUS: false,

        // Allow legacy? Hybrid contract address are supported in this version.
        ALLOW_LEGACY: false,
    },

    POW: {
        PREIMAGE_LENGTH: 32,
    },

    CONTRACTS: {
        /** The maximum size of a calldata in bytes. */
        MAXIMUM_CONTRACT_SIZE_COMPRESSED: 128 * 1024, // max is 128KO compressed.

        /** The maximum size of calldata in bytes. */
        MAXIMUM_CALLDATA_SIZE_COMPRESSED: 380 * 1024, // max is 380KO compressed.

        /** Special contracts */
        SPECIAL_CONTRACTS: {
            [ChainIds.Bitcoin]: {
                [BitcoinNetwork.mainnet]: SPECIAL_CONTRACTS_ROSWELL_MAINNET,
                [BitcoinNetwork.testnet]: SPECIAL_CONTRACTS_ROSWELL_TESTNET,
                [BitcoinNetwork.regtest]: SPECIAL_CONTRACTS_ROSWELL_REGTEST,
            },
        },
    },

    COMPRESSION: {
        MAX_DECOMPRESSED_SIZE: Math.ceil(1024 * 1024 * 1.5), // max is 1.5MB decompressed.
    },

    NETWORK: {
        /** Networking */
        MAXIMUM_TRANSACTION_BROADCAST_SIZE: 400_000, // Cap to 400KO.

        PSBT_MAXIMUM_TRANSACTION_BROADCAST_SIZE: 0, // Disabled.
    },

    GAS: {
        COST: {
            COLD_STORAGE_LOAD: 21_000_000n,
        },

        /** How many sat of gas is equal to 1 sat of priority */
        GAS_PENALTY_FACTOR: 1n,

        /** Target block gas limit, a transaction can not pass this limit. */
        TARGET_GAS: 10_000_000_000_000n, // 0.1 BTC.

        /** Smooth out gas increase when equal to gas target. */
        SMOOTH_OUT_GAS_INCREASE: 1_000_000_000n,

        /**
         * Maximum theoretical upper limit, all transactions after this limit will revert for being out of gas.
         * Can overflow up to the value set to TARGET_GAS.
         */
        MAX_THEORETICAL_GAS: 15_000_000_000_000n, // 0.15 BTC

        /** Max gas per transactions */
        TRANSACTION_MAX_GAS: 2_550_000_000_000n, // 0.025 BTC.

        /** btc_call maximum gas */
        EMULATION_MAX_GAS: 2_500_000_000_000n, // 0.025 BTC.

        /** Panic gas cost */
        PANIC_GAS_COST: 100_000_000n,

        /** Converts satoshi to BTC */
        SAT_TO_GAS_RATIO: 1_000_000n,

        /** Minimum base gas, sat/gas unit */
        MIN_BASE_GAS: 1.0,

        /** Smoothing factor for EMA */
        SMOOTHING_FACTOR: 0.4,

        /** Adjustment factor when G_t > G_targetBlock */
        ALPHA1: 0.5,

        /** Adjustment factor when G_t <= G_targetBlock */
        ALPHA2: 1.0,

        /** Target utilization ratio */
        U_TARGET: 1.0,
    },

    TRANSACTIONS: {
        EVENTS: {
            /** The maximum size of an event in bytes */
            MAXIMUM_EVENT_LENGTH: 1024 * 1024, // 1 Mo.

            /** The maximum size of all events combined  */
            MAXIMUM_TOTAL_EVENT_LENGTH: 1024 * 1024 * 2, // 4 Mo.

            /** The maximum size of an event name in bytes */
            MAXIMUM_EVENT_NAME_LENGTH: 64,
        },

        /** The maximum size of a receipt in bytes */
        MAXIMUM_RECEIPT_LENGTH: 2048,

        /** The maximum amount of contract a transaction can deploy */
        MAXIMUM_DEPLOYMENT_DEPTH: 2,

        /** The maximum amount of calls possible in a transaction */
        MAXIMUM_CALL_DEPTH: 200, // up to 200 contract call in a single transaction.

        /** Check for reentrancy */
        REENTRANCY_GUARD: false,

        /** The cost of a byte in gas */
        STORAGE_COST_PER_BYTE: 10_000n,

        /** Skip proof validation for execution before transaction */
        SKIP_PROOF_VALIDATION_FOR_EXECUTION_BEFORE_TRANSACTION: true,

        ENABLE_ACCESS_LIST: false,
    },

    VM: {
        UTXOS: {
            /** The maximum inputs utxos to forward to a contract */
            MAXIMUM_INPUTS: 250,

            /** The maximum outputs utxos to forward to a contract */
            MAXIMUM_OUTPUTS: 250,

            WRITE_FLAGS: true,

            INPUTS: {
                WRITE_COINBASE: true,
            },

            OUTPUTS: {
                WRITE_SCRIPT_PUB_KEY: true,
            },

            OP_RETURN: {
                ENABLED: true,
                MAXIMUM_SIZE: 80,
            },
        },
    },

    PSBT: {
        MINIMAL_PSBT_ACCEPTANCE_FEE_VB_PER_SAT: 5n,
    },
};
