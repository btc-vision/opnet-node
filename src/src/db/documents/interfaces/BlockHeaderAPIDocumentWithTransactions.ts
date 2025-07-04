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
    extends Omit<TransactionDocumentBase<T>, 'outputs' | 'inputs' | 'id' | 'hash'> {
    readonly hash: string;
    readonly id: string;
    readonly blockNumber?: string;

    readonly burnedBitcoin: string;
    readonly revert: string | undefined;

    readonly contractAddress?: string;
    from?: string;
    contractTweakedPublicKey?: string;
    contractHybridPublicKey?: string;

    pow?: {
        preimage?: string;
        reward?: string;
    };

    readonly events: EventReceiptDataForAPI[];
    readonly gasUsed: string;
    readonly specialGasUsed: string;
    readonly priorityFee: string;

    readonly outputs: APIDocumentOutput[];
    readonly inputs: APIDocumentInput[];

    blockHeight: undefined;
    deployedTransactionHash: undefined;
    deployedTransactionId: undefined;
    reward: undefined;
    preimage: undefined;

    _id: undefined;
}

export interface BlockHeaderAPIDocumentWithTransactions extends BlockHeaderAPIBlockDocument {
    readonly transactions: TransactionDocumentForAPI<OPNetTransactionTypes>[];
    readonly deployments: string[];
}

export interface BlockWithTransactions {
    readonly transactions: ITransactionDocument<OPNetTransactionTypes>[];
    readonly block: BlockHeaderAPIBlockDocument;
    readonly deployments: string[];
}
