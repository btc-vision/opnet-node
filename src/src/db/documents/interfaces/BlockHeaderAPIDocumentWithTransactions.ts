import { OPNetTransactionTypes } from '../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { BlockHeaderAPIBlockDocument } from '../../interfaces/IBlockHeaderBlockDocument.js';
import {
    ITransactionDocument,
    TransactionDocumentBase,
} from '../../interfaces/ITransactionDocument.js';

export interface EventReceiptDataForAPI {
    readonly contractAddress: string;
    readonly eventType: string;
    readonly eventDataSelector: string;
    readonly eventData: string;
}

export interface TransactionDocumentForAPI<T extends OPNetTransactionTypes>
    extends TransactionDocumentBase<T> {
    readonly burnedBitcoin: string;
    readonly revert: string | undefined;

    readonly events: EventReceiptDataForAPI[];
    readonly gasUsed: string;

    blockHeight: undefined;
    deployedTransactionHash: undefined;
    deployedTransactionId: undefined;

    unwrapAmount?: string;
    requestedAmount?: string;
    wrappingFees?: string;
    depositAmount?: string;

    _id: undefined;
}

export interface BlockHeaderAPIDocumentWithTransactions extends BlockHeaderAPIBlockDocument {
    transactions: TransactionDocumentForAPI<OPNetTransactionTypes>[];
}

export interface BlockWithTransactions {
    transactions: ITransactionDocument<OPNetTransactionTypes>[];
    block: BlockHeaderAPIBlockDocument;
}
