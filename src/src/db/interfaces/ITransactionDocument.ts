import { IBaseDocument } from '@btc-vision/bsi-common';
import { Binary, Decimal128 } from 'mongodb';
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
import { TrustedCompanies } from '../../poa/configurations/TrustedCompanies.js';
import { PartialWBTCUTXODocument, UsedUTXOToDelete } from './IWBTCUTXODocument.js';

export interface TransactionDocumentBasic<T extends OPNetTransactionTypes> {
    readonly id: string;
    readonly hash: string;

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
    readonly gasUsed: Decimal128;

    readonly inputs: ITransactionInput[];
    readonly outputs: ITransactionOutput[];

    readonly revert: Binary | undefined;
}

export type ExtendedBaseInfo<T extends OPNetTransactionTypes> = TransactionDocument<T> & {
    readonly from: Binary;
    readonly contractAddress: string;
    readonly contractTweakedPublicKey: Binary;
};

interface InteractionBase {
    readonly events: NetEventDocument[];
    readonly receipt?: Binary;
    readonly receiptProofs?: string[];

    readonly gasUsed: Decimal128;
}

export interface DeploymentTransactionDocument
    extends ExtendedBaseInfo<OPNetTransactionTypes.Deployment>,
        InteractionBase {}

export interface NetEventDocument {
    readonly type: string;
    readonly data: Binary | Uint8Array;
    readonly contractAddress: Address;
}

export interface InteractionTransactionDocument
    extends ExtendedBaseInfo<InteractionTransactionType>,
        InteractionBase {
    readonly calldata: Binary;
    readonly senderPubKeyHash: Binary;
    readonly contractSecret: Binary;
    readonly interactionPubKey: Binary;

    readonly wasCompressed: boolean;
}

export interface IWrapInteractionTransactionDocument extends InteractionTransactionDocument {
    readonly pubKeys: Binary[];
    readonly vault: string;
    readonly depositAmount: Decimal128;
    readonly minimumSignatures: number;

    readonly wrappingFees: Decimal128;

    readonly penalized: boolean;
    readonly depositAddress: Address;
}

export interface IUnwrapInteractionTransactionDocument extends InteractionTransactionDocument {
    readonly authorizedBy: TrustedCompanies[];
    readonly usedUTXOs: UsedUTXOToDelete[];
    readonly consolidatedVault: PartialWBTCUTXODocument | undefined;
    readonly unwrapAmount: Decimal128;
    readonly requestedAmount: Decimal128;
}

export type ITransactionDocument<T extends OPNetTransactionTypes> = TransactionDocument<T> &
    IBaseDocument;
