/** A single transaction input as exposed by the mempool API. */
export interface MempoolTransactionInput {
    /** The txid of the referenced output. */
    readonly transactionId: string;
    /** The vout index of the referenced output. */
    readonly outputIndex: number;
}

/** A single transaction output as exposed by the mempool API. */
export interface MempoolTransactionOutput {
    /** The destination address, or `null` for unspendable outputs. */
    readonly address: string | null;
    /** The vout index within the transaction. */
    readonly outputIndex: number;
    /** The output value in satoshis (decimal string). */
    readonly value: string;
    /** The hex-encoded scriptPubKey. */
    readonly scriptPubKey: string;
}

/** Full representation of a pending mempool transaction returned by the API. */
export interface MempoolTransactionData {
    /** Internal transaction identifier (txid). */
    readonly id: string;
    /** ISO-8601 timestamp of when the transaction was first seen. */
    readonly firstSeen: string;
    /** Block height at which the transaction was observed (`0x`-prefixed hex). */
    readonly blockHeight: string;
    /** The OPNet transaction type (Generic, Interaction, Deployment). */
    readonly transactionType: string;
    /** Whether the transaction was submitted as a PSBT. */
    readonly psbt: boolean;
    /** The transaction inputs. */
    readonly inputs: MempoolTransactionInput[];
    /** The transaction outputs. */
    readonly outputs: MempoolTransactionOutput[];
    /** The full raw transaction as a hex string. */
    readonly raw: string;

    // OPNet-specific fields (present only for OPNet transactions)

    /** Theoretical gas limit for OPNet execution (`0x`-prefixed hex). */
    readonly theoreticalGasLimit?: string;
    /** Priority fee attached to the transaction (`0x`-prefixed hex). */
    readonly priorityFee?: string;
    /** The sender address (p2tr format). */
    readonly from?: string;
    /** The target contract address (p2op format). */
    readonly contractAddress?: string;
    /** Hex-encoded calldata. */
    readonly calldata?: string;
    /** Hex-encoded bytecode (deployment transactions only). */
    readonly bytecode?: string;
}
