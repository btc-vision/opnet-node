import { DataConverter } from '@btc-vision/bsi-db';
import { Binary } from 'mongodb';
import { OPNetTransactionTypes } from '../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { TransactionDocumentForAPI } from '../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import {
    ITransactionDocument,
    NetEventDocument,
} from '../../db/interfaces/ITransactionDocument.js';

export class TransactionConverterForAPI {
    public static convertTransactionToAPI(
        transaction: ITransactionDocument<OPNetTransactionTypes>,
    ): TransactionDocumentForAPI<OPNetTransactionTypes> {
        const revert = transaction.revert
            ? Binary.createFromHexString(transaction.revert.toString('hex'))
            : undefined;

        let newTx: TransactionDocumentForAPI<OPNetTransactionTypes> = {
            ...transaction,
            outputs: transaction.outputs?.map((output) => {
                return {
                    ...output,
                    value: output.value.toString(),
                };
            }),
            events: transaction.events?.map((event: NetEventDocument) => {
                return {
                    contractAddress: event.contractAddress,
                    eventType: event.eventType,
                    eventDataSelector: event.eventDataSelector.toString(),
                    eventData: (event.eventData instanceof Uint8Array
                        ? new Binary(event.eventData)
                        : event.eventData
                    ).toString('base64'),
                };
            }),
            revert: revert?.toString('base64'),
            burnedBitcoin:
                '0x' + DataConverter.fromDecimal128(transaction.burnedBitcoin || 0n).toString(16),
            gasUsed: '0x' + DataConverter.fromDecimal128(transaction.gasUsed || 0n).toString(16),
            _id: undefined,
            blockHeight: undefined,
            deployedTransactionHash: undefined,
            deployedTransactionId: undefined,
        };

        if (transaction.wrappingFees) {
            newTx.wrappingFees =
                '0x' + DataConverter.fromDecimal128(transaction.wrappingFees).toString(16);
        }

        if (transaction.depositAmount) {
            newTx.depositAmount =
                '0x' + DataConverter.fromDecimal128(transaction.depositAmount).toString(16);
        }

        delete newTx._id;
        delete newTx.blockHeight;

        delete newTx.deployedTransactionId;
        delete newTx.deployedTransactionHash;

        return newTx;
    }
}
