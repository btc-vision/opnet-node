import { DataConverter } from '@btc-vision/bsi-db';
import { Binary, Decimal128 } from 'mongodb';
import { OPNetTransactionTypes } from '../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { TransactionDocumentForAPI } from '../../db/documents/interfaces/BlockHeaderAPIDocumentWithTransactions.js';
import {
    ITransactionDocument,
    NetEventDocument,
} from '../../db/interfaces/ITransactionDocument.js';

// TODO: Fix typings.

export class TransactionConverterForAPI {
    public static convertTransactionToAPI(
        transaction: ITransactionDocument<OPNetTransactionTypes>,
    ): TransactionDocumentForAPI<OPNetTransactionTypes> {
        const revert = transaction.revert
            ? Binary.createFromHexString(transaction.revert.toString('hex'))
            : undefined;

        const newTx: TransactionDocumentForAPI<OPNetTransactionTypes> = {
            ...transaction,
            inputs: transaction.inputs?.map((input) => {
                return {
                    ...input,
                    //pubKey: input.pubKey?.toString('base64'),
                    //pubKeyHash: input.pubKeyHash?.toString('base64'),
                };
            }),
            outputs: transaction.outputs?.map((output) => {
                return {
                    ...output,
                    value: output.value.toString(),
                    //pubKeys: output.pubKeys?.map((key) => key.toString('base64')),
                    //pubKeyHash: output.pubKeyHash?.toString('base64'),
                    //schnorrPubKey: output.schnorrPubKey?.toString('base64'),
                };
            }),
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
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

        if (transaction.wrappingFees !== undefined && transaction.wrappingFees !== null) {
            if (transaction.wrappingFees instanceof Decimal128) {
                newTx.wrappingFees =
                    '0x' + DataConverter.fromDecimal128(transaction.wrappingFees).toString(16);
            } else {
                throw new Error('Wrapping fees must be a Decimal128');
            }
        }

        if (transaction.unwrapAmount !== undefined && transaction.unwrapAmount !== null) {
            if (transaction.unwrapAmount instanceof Decimal128) {
                newTx.unwrapAmount =
                    '0x' + DataConverter.fromDecimal128(transaction.unwrapAmount).toString(16);
            } else {
                throw new Error('Unwrap amount must be a Decimal128');
            }
        }

        if (transaction.requestedAmount !== undefined && transaction.requestedAmount !== null) {
            if (transaction.requestedAmount instanceof Decimal128) {
                newTx.requestedAmount =
                    '0x' + DataConverter.fromDecimal128(transaction.requestedAmount).toString(16);
            } else {
                throw new Error('Requested amount must be a Decimal128');
            }
        }

        if (transaction.depositAmount !== undefined && transaction.depositAmount !== null) {
            if (transaction.depositAmount instanceof Decimal128) {
                newTx.depositAmount =
                    '0x' + DataConverter.fromDecimal128(transaction.depositAmount).toString(16);
            } else {
                throw new Error('Deposit amount must be a Decimal128');
            }
        }

        if (transaction.consolidatedVault !== undefined && transaction.consolidatedVault !== null) {
            newTx.consolidatedVault = {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access
                vault: transaction.consolidatedVault.vault,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access
                hash: transaction.consolidatedVault.hash,
                value:
                    '0x' +
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument,@typescript-eslint/no-unsafe-member-access
                    DataConverter.fromDecimal128(transaction.consolidatedVault.value).toString(16),
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access
                outputIndex: transaction.consolidatedVault.outputIndex,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-assignment
                output: transaction.consolidatedVault.output.toString('base64'),
            };
        }

        delete newTx._id;
        delete newTx.blockHeight;

        delete newTx.deployedTransactionId;
        delete newTx.deployedTransactionHash;

        return newTx;
    }
}
