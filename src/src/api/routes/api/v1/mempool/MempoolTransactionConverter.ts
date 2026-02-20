import { toHex } from '@btc-vision/bitcoin';
import { IMempoolTransactionObj } from '../../../../../db/interfaces/IMempoolTransaction.js';
import { MempoolTransactionData } from '../../../../json-rpc/types/interfaces/results/mempool/MempoolTransactionData.js';

/**
 * Converts raw mempool database objects into the API-facing {@link MempoolTransactionData} shape.
 */
export class MempoolTransactionConverter {
    /**
     * Converts a single mempool transaction from its database representation to the API format.
     *
     * @param tx - The raw mempool transaction object from storage.
     * @returns A serialisable API response object with hex-encoded numeric fields.
     */
    public static convert(tx: IMempoolTransactionObj): MempoolTransactionData {
        return {
            id: tx.id,
            firstSeen: tx.firstSeen ? tx.firstSeen.toISOString() : new Date(0).toISOString(),
            blockHeight: '0x' + tx.blockHeight.toString(16),
            transactionType: tx.transactionType,
            psbt: tx.psbt,
            inputs: tx.inputs.map((input) => ({
                transactionId: input.transactionId,
                outputIndex: input.outputIndex,
            })),
            outputs: tx.outputs.map((output) => ({
                address: output.address,
                outputIndex: output.outputIndex,
                value: output.value.toString(),
                scriptPubKey: toHex(output.data),
            })),
            raw: toHex(tx.data),
            theoreticalGasLimit:
                tx.theoreticalGasLimit !== undefined
                    ? '0x' + tx.theoreticalGasLimit.toString(16)
                    : undefined,
            priorityFee:
                tx.priorityFee !== undefined
                    ? '0x' + tx.priorityFee.toString(16)
                    : undefined,
            from: tx.from,
            contractAddress: tx.contractAddress,
            calldata: tx.calldata,
            bytecode: tx.bytecode,
        };
    }

    /**
     * Batch-converts an array of mempool transactions.
     *
     * @param txs - The raw mempool transaction objects from storage.
     * @returns An array of API-formatted transaction objects.
     */
    public static convertMany(txs: IMempoolTransactionObj[]): MempoolTransactionData[] {
        return txs.map(MempoolTransactionConverter.convert.bind(MempoolTransactionConverter));
    }
}
