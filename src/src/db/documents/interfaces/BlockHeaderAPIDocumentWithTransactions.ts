import { OPNetTransactionTypes } from '../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { BlockHeaderAPIBlockDocument } from '../../interfaces/IBlockHeaderBlockDocument.js';
import {
    ITransactionDocument,
    TransactionDocumentBase,
} from '../../interfaces/ITransactionDocument.js';
import { APIDocumentOutput } from '../../../blockchain-indexer/processor/transaction/inputs/TransactionOutput.js';
import { APIDocumentInput } from '../../../blockchain-indexer/processor/transaction/inputs/TransactionInput.js';

export interface EventReceiptDataForAPI {
    readonly contractAddress: string;
    readonly type: string;
    readonly data: string;
}

export interface TransactionDocumentForAPI<T extends OPNetTransactionTypes>
    extends Omit<TransactionDocumentBase<T>, 'outputs' | 'inputs'> {
    readonly burnedBitcoin: string;
    readonly revert: string | undefined;

    readonly contractAddress?: string;
    from?: string;
    contractTweakedPublicKey?: string;

    readonly events: EventReceiptDataForAPI[];
    readonly gasUsed: string;

    readonly outputs: APIDocumentOutput[];
    readonly inputs: APIDocumentInput[];

    blockHeight: undefined;
    deployedTransactionHash: undefined;
    deployedTransactionId: undefined;

    unwrapAmount?: string;
    requestedAmount?: string;
    wrappingFees?: string;
    depositAmount?: string;
    //consolidatedVault?: PartialWBTCUTXODocumentForAPI;

    _id: undefined;
}

export interface BlockHeaderAPIDocumentWithTransactions extends BlockHeaderAPIBlockDocument {
    readonly transactions: TransactionDocumentForAPI<OPNetTransactionTypes>[];
}

export interface BlockWithTransactions {
    readonly transactions: ITransactionDocument<OPNetTransactionTypes>[];
    readonly block: BlockHeaderAPIBlockDocument;
}
