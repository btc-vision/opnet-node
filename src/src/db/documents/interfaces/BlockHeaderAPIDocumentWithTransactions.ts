import { OPNetTransactionTypes } from '../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { BlockHeaderAPIBlockDocument } from '../../interfaces/IBlockHeaderBlockDocument.js';
import {
    ITransactionDocument,
    TransactionDocumentBase,
} from '../../interfaces/ITransactionDocument.js';

export interface TransactionDocumentForAPI<T extends OPNetTransactionTypes>
    extends TransactionDocumentBase<T> {
    readonly burnedBitcoin: string;
    readonly revert: string | undefined;

    blockHeight: undefined;
    deployedTransactionHash: undefined;
    deployedTransactionId: undefined;

    _id: undefined;
}

export interface BlockHeaderAPIDocumentWithTransactions extends BlockHeaderAPIBlockDocument {
    transactions: TransactionDocumentForAPI<OPNetTransactionTypes>[];
}

export interface BlockWithTransactions {
    transactions: ITransactionDocument<OPNetTransactionTypes>[];
    block: BlockHeaderAPIBlockDocument;
}
