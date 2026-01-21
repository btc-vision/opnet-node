import { OPNetConsensus } from '../../configurations/OPNetConsensus.js';

export class TransactionSizeValidator {
    public verifyTransactionSize(byteLength: number, psbt: boolean): boolean {
        // Verify transaction size.
        if (
            psbt &&
            byteLength > OPNetConsensus.consensus.NETWORK.PSBT_MAXIMUM_TRANSACTION_BROADCAST_SIZE
        ) {
            return true;
        } else if (
            !psbt &&
            byteLength > OPNetConsensus.consensus.NETWORK.MAXIMUM_TRANSACTION_BROADCAST_SIZE
        ) {
            return true;
        }

        return false;
    }
}
