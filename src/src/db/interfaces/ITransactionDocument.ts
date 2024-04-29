import { NetEvent } from '@btc-vision/bsi-binary';
import { IBaseDocument } from '@btc-vision/bsi-common';
import { Binary, Decimal128 } from 'mongodb';
import { OPNetTransactionTypes } from '../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import {
    APIDocumentInput,
    TransactionInput,
} from '../../blockchain-indexer/processor/transaction/inputs/TransactionInput.js';
import {
    APIDocumentOutput,
    ITransactionOutput,
} from '../../blockchain-indexer/processor/transaction/inputs/TransactionOutput.js';

export interface TransactionDocumentBase<T extends OPNetTransactionTypes> {
    readonly id: string;
    readonly hash: string;

    readonly index: number; // Mark the order of the transaction in the block

    readonly blockHeight: Decimal128 | string;
    readonly burnedBitcoin: Decimal128 | string;
    readonly revert: Binary | undefined | string;

    readonly inputs: TransactionInput[] | APIDocumentInput[];
    readonly outputs: ITransactionOutput[] | APIDocumentOutput[];

    readonly OPNetType: T;
}

export interface TransactionDocument<T extends OPNetTransactionTypes>
    extends TransactionDocumentBase<T> {
    readonly blockHeight: Decimal128;
    readonly burnedBitcoin: Decimal128;

    readonly revert: Binary | undefined;
}

type ExtendedBaseInfo<T extends OPNetTransactionTypes> = TransactionDocument<T> & {
    readonly from: string;
    readonly contractAddress: string;
};

export interface DeploymentTransactionDocument
    extends ExtendedBaseInfo<OPNetTransactionTypes.Deployment> {}

export interface InteractionTransactionDocument
    extends ExtendedBaseInfo<OPNetTransactionTypes.Interaction> {
    readonly calldata: Binary;
    readonly senderPubKeyHash: Binary;
    readonly contractSecret: Binary;
    readonly interactionPubKey: Binary;

    readonly wasCompressed: boolean;

    readonly events: NetEvent[];
    readonly receipt?: Binary;
    readonly receiptProofs?: string[];
}

export type ITransactionDocument<T extends OPNetTransactionTypes> = TransactionDocument<T> &
    IBaseDocument;
