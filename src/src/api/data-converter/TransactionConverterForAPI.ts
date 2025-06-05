import { DataConverter } from '@btc-vision/bsi-db';
import { Binary } from 'mongodb';
import { OPNetTransactionTypes } from '../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import {
    EventReceiptDataForAPI,
    TransactionDocumentForAPI,
} from '../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import {
    ExtendedBaseInfo,
    InteractionTransactionDocument,
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

        const events: EventReceiptDataForAPI[] =
            'events' in transaction
                ? ((transaction as InteractionTransactionDocument).events.map(
                      (event: NetEventDocument) => {
                          return {
                              contractAddress: '0x' + event.contractAddress.toString('hex'),
                              type: (event.type instanceof Uint8Array
                                  ? new Binary(event.type)
                                  : event.type
                              ).toString('utf8'),
                              data: (event.data instanceof Uint8Array
                                  ? new Binary(event.data)
                                  : event.data
                              ).toString('base64'),
                          };
                      },
                  ) satisfies EventReceiptDataForAPI[])
                : [];

        const newTx: TransactionDocumentForAPI<OPNetTransactionTypes> = {
            ...transaction,
            hash: transaction.hash.toString('hex'),
            id: transaction.id.toString('hex'),
            inputs: transaction.inputs?.map((input) => {
                return {
                    ...input,
                    originalTransactionId: input.originalTransactionId?.toString('hex'),
                    scriptSignature: input.scriptSignature,
                };
            }),
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
            specialGasUsed:
                '0x' + DataConverter.fromDecimal128(transaction.specialGasUsed || 0n).toString(16),
            priorityFee:
                '0x' + DataConverter.fromDecimal128(transaction.priorityFee || 0n).toString(16),
            _id: undefined,
            blockHeight: undefined,
            deployedTransactionHash: undefined,
            deployedTransactionId: undefined,
            reward: undefined,
            preimage: undefined,
        };

        if ('preimage' in transaction) {
            const tx = transaction as ExtendedBaseInfo<OPNetTransactionTypes>;
            newTx.pow = {
                preimage: tx.preimage.toString('base64'),
                reward: '0x' + tx.reward.toString(16),
            };
        }

        if ('contractTweakedPublicKey' in transaction) {
            const tx = transaction as ExtendedBaseInfo<OPNetTransactionTypes>;
            newTx.contractTweakedPublicKey = tx.contractTweakedPublicKey.toString('base64');
        }

        if ('from' in transaction) {
            const tx = transaction as ExtendedBaseInfo<OPNetTransactionTypes>;
            newTx.from = tx.from ? tx.from.toString('base64') : undefined;
        }

        delete newTx._id;
        delete newTx.blockHeight;

        delete newTx.deployedTransactionId;
        delete newTx.deployedTransactionHash;

        return newTx;
    }
}
