import { IBaseDocument } from '@btc-vision/bsi-common';
import { Binary, Decimal128 } from 'mongodb';
import { OPNetTransactionTypes } from '../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { TransactionInput } from '../../blockchain-indexer/processor/transaction/inputs/TransactionInput.js';
import { ITransactionOutput } from '../../blockchain-indexer/processor/transaction/inputs/TransactionOutput.js';
import { NetEvent } from '../../vm/events/NetEvent.js';

export interface TransactionDocument<T extends OPNetTransactionTypes> {
    readonly id: string;
    readonly hash: string;
    readonly blockHeight: Decimal128;
    readonly index: number; // Mark the order of the transaction in the block
    readonly burnedBitcoin: Decimal128;

    readonly revert: Binary | undefined;

    readonly inputs: TransactionInput[];
    readonly outputs: ITransactionOutput[];

    readonly OPNetType: T;
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

    readonly events: NetEvent[];
    readonly receipt?: Binary;
}

export type ITransactionDocument<T extends OPNetTransactionTypes> = TransactionDocument<T> &
    IBaseDocument;
