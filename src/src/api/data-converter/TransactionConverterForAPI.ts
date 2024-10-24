import { DataConverter } from '@btc-vision/bsi-db';
import { Binary } from 'mongodb';
import { OPNetTransactionTypes } from '../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import {
    EventReceiptDataForAPI,
    TransactionDocumentForAPI,
} from '../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import {
    InteractionTransactionDocument,
    IUnwrapInteractionTransactionDocument,
    IWrapInteractionTransactionDocument,
    NetEventDocument,
    TransactionDocument,
} from '../../db/interfaces/ITransactionDocument.js';

export class TransactionConverterForAPI {
    public static convertTransactionToAPI(
        transaction: TransactionDocument<OPNetTransactionTypes>,
    ): TransactionDocumentForAPI<OPNetTransactionTypes> {
        const revert = transaction.revert
            ? Binary.createFromHexString(transaction.revert.toString('hex'))
            : undefined;

        const events: EventReceiptDataForAPI[] =
            'events' in transaction
                ? ((transaction as InteractionTransactionDocument).events.map(
                      (event: NetEventDocument) => {
                          return {
                              contractAddress: event.contractAddress.toHex(),
                              eventType: event.eventType,
                              eventData: (event.eventData instanceof Uint8Array
                                  ? new Binary(event.eventData)
                                  : event.eventData
                              ).toString('base64'),
                          };
                      },
                  ) satisfies EventReceiptDataForAPI[])
                : [];

        const newTx: TransactionDocumentForAPI<OPNetTransactionTypes> = {
            ...transaction,
            inputs: transaction.inputs,
            outputs: transaction.outputs?.map((output) => {
                return {
                    ...output,
                    value: output.value.toString(),
                };
            }),
            events: events,
            revert: revert?.toString('base64'),
            burnedBitcoin:
                '0x' + DataConverter.fromDecimal128(transaction.burnedBitcoin || 0n).toString(16),
            gasUsed: '0x' + DataConverter.fromDecimal128(transaction.gasUsed || 0n).toString(16),
            _id: undefined,
            blockHeight: undefined,
            deployedTransactionHash: undefined,
            deployedTransactionId: undefined,
        };

        if ('wrappingFees' in transaction) {
            const tx = transaction as IWrapInteractionTransactionDocument;

            newTx.wrappingFees = '0x' + DataConverter.fromDecimal128(tx.wrappingFees).toString(16);
            newTx.depositAmount =
                '0x' + DataConverter.fromDecimal128(tx.depositAmount).toString(16);
        }

        if ('unwrapAmount' in transaction) {
            const tx = transaction as IUnwrapInteractionTransactionDocument;

            newTx.unwrapAmount = '0x' + DataConverter.fromDecimal128(tx.unwrapAmount).toString(16);
            newTx.requestedAmount =
                '0x' + DataConverter.fromDecimal128(tx.requestedAmount).toString(16);

            if (tx.consolidatedVault) {
                newTx.consolidatedVault = {
                    vault: tx.consolidatedVault.vault,
                    hash: tx.consolidatedVault.hash,
                    value:
                        '0x' +
                        DataConverter.fromDecimal128(tx.consolidatedVault.value).toString(16),
                    outputIndex: tx.consolidatedVault.outputIndex,
                    output: tx.consolidatedVault.output.toString('base64'),
                };
            }
        }

        delete newTx._id;
        delete newTx.blockHeight;

        delete newTx.deployedTransactionId;
        delete newTx.deployedTransactionHash;

        return newTx;
    }
}
