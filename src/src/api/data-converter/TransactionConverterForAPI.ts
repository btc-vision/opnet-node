import { Binary } from 'mongodb';
import { OPNetTransactionTypes } from '../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { TransactionDocumentForAPI } from '../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import { ITransactionDocument } from '../../db/interfaces/ITransactionDocument.js';

export class TransactionConverterForAPI {
    public static convertTransactionToAPI(
        transaction: ITransactionDocument<OPNetTransactionTypes>,
    ): TransactionDocumentForAPI<OPNetTransactionTypes> {
        const revert = transaction.revert
            ? Binary.createFromHexString(transaction.revert.toString('hex'))
            : undefined;

        let newTx: TransactionDocumentForAPI<OPNetTransactionTypes> = {
            ...transaction,
            outputs: transaction.outputs.map((output) => {
                return {
                    ...output,
                    value: output.value.toString(),
                };
            }),
            revert: revert?.toString('base64'),
            burnedBitcoin: transaction.burnedBitcoin.toString(),
            _id: undefined,
            blockHeight: undefined,
            deployedTransactionHash: undefined,
            deployedTransactionId: undefined,
        };

        delete newTx._id;
        delete newTx.blockHeight;

        delete newTx.deployedTransactionId;
        delete newTx.deployedTransactionHash;

        return newTx;
    }
}
