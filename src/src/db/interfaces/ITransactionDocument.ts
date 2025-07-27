import { IBaseDocument } from '@btc-vision/bsi-common';
import { Binary, Decimal128, Long } from 'mongodb';
import {
    InteractionTransactionType,
    OPNetTransactionTypes,
} from '../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import {
    ITransactionInput,
    TransactionInput,
} from '../../blockchain-indexer/processor/transaction/inputs/TransactionInput.js';
import {
    ITransactionOutput,
    TransactionOutput,
} from '../../blockchain-indexer/processor/transaction/inputs/TransactionOutput.js';
import { Address } from '@btc-vision/transaction';

export interface TransactionDocumentBasic<T extends OPNetTransactionTypes> {
    readonly id: Buffer;
    readonly hash: Buffer;
    readonly raw: Buffer;

    readonly index: number; // Mark the order of the transaction in the block
    readonly blockHeight: Decimal128 | string | undefined;

    readonly inputs: TransactionInput[];
    readonly outputs: TransactionOutput[];

    readonly OPNetType: T;
}

export interface ITransactionDocumentBasic<T extends OPNetTransactionTypes>
    extends TransactionDocumentBasic<T> {
    readonly blockHeight: Decimal128;
}

export interface TransactionDocumentBase<T extends OPNetTransactionTypes>
    extends TransactionDocumentBasic<T> {
    readonly burnedBitcoin: Decimal128 | string;
    readonly revert: Binary | undefined | string;
}

export interface TransactionDocument<T extends OPNetTransactionTypes>
    extends Omit<TransactionDocumentBase<T>, 'inputs' | 'outputs'> {
    readonly blockHeight: Decimal128;
    readonly burnedBitcoin: Decimal128;
    readonly reward: Long;
    readonly gasUsed: Decimal128;
    readonly specialGasUsed: Decimal128;
    readonly priorityFee: Decimal128;

    readonly inputs: ITransactionInput[];
    readonly outputs: ITransactionOutput[];

    readonly revert: Binary | undefined;
}

export interface TransactionSafeThread {
    readonly burnedBitcoin: string;
    readonly reward: string;
    readonly priorityFee: string;
}

export interface InteractionTransactionSafeThread extends TransactionSafeThread {
    readonly calldata: Buffer;
    readonly preimage: Buffer;
    readonly miner: Buffer;
    readonly senderPubKeyHash: Buffer;
    readonly contractSecret: Buffer;
    readonly interactionPubKey: Buffer;
    readonly contractAddress: Uint8Array;
    readonly from: Uint8Array;
    readonly wasCompressed: boolean;
}

export type ExtendedBaseInfo<T extends OPNetTransactionTypes> = TransactionDocument<T> & {
    readonly from: Binary;
    readonly contractAddress: string;
    readonly contractTweakedPublicKey: Binary;
    readonly preimage: Binary;
};

interface InteractionBase {
    readonly events: NetEventDocument[];
    readonly receipt?: Binary;
    readonly receiptProofs?: string[];

    readonly gasUsed: Decimal128;
}

export interface DeploymentTransactionDocument
    extends ExtendedBaseInfo<OPNetTransactionTypes.Deployment>,
        InteractionBase {
    readonly preimage: Binary;
    readonly calldata: Binary;
}

export interface NetEventDocument {
    readonly type: Binary | Uint8Array;
    readonly data: Binary | Uint8Array;
    readonly contractAddress: Address | Binary;
}

export interface InteractionTransactionDocument
    extends ExtendedBaseInfo<InteractionTransactionType>,
        InteractionBase {
    readonly calldata: Binary;
    readonly preimage: Binary;
    readonly senderPubKeyHash: Binary;
    readonly contractSecret: Binary;
    readonly interactionPubKey: Binary;

    readonly wasCompressed: boolean;
}

export type ITransactionDocument<T extends OPNetTransactionTypes> = TransactionDocument<T> &
    IBaseDocument;
