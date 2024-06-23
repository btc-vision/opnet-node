import { IBaseDocument } from '@btc-vision/bsi-common';
import { Binary, Decimal128 } from 'mongodb';
import {
    InteractionTransactionType,
    OPNetTransactionTypes,
} from '../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import {
    APIDocumentInput,
    TransactionInput,
} from '../../blockchain-indexer/processor/transaction/inputs/TransactionInput.js';
import {
    APIDocumentOutput,
    ITransactionOutput,
} from '../../blockchain-indexer/processor/transaction/inputs/TransactionOutput.js';
import { Address } from '@btc-vision/bsi-binary';
import { TrustedCompanies } from '../../poa/configurations/TrustedCompanies.js';
import { IWBTCUTXODocument, PartialWBTCUTXODocument, UsedUTXOToDelete } from './IWBTCUTXODocument.js';

export interface TransactionDocumentBase<T extends OPNetTransactionTypes> {
    readonly id: string;
    readonly hash: string;

    readonly index: number; // Mark the order of the transaction in the block

    readonly blockHeight: Decimal128 | string | undefined;
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
    readonly gasUsed: Decimal128;

    readonly revert: Binary | undefined;
}

export type ExtendedBaseInfo<T extends OPNetTransactionTypes> = TransactionDocument<T> & {
    readonly from: string;
    readonly contractAddress: string;
};

export interface DeploymentTransactionDocument
    extends ExtendedBaseInfo<OPNetTransactionTypes.Deployment> {
    readonly virtualAddress: string;
    readonly p2trAddress: string;
}

export interface NetEventDocument {
    readonly eventType: string;
    readonly eventDataSelector: Decimal128;
    readonly eventData: Binary;
    readonly contractAddress: string;
}

export interface InteractionTransactionDocument
    extends ExtendedBaseInfo<InteractionTransactionType> {
    readonly calldata: Binary;
    readonly senderPubKeyHash: Binary;
    readonly contractSecret: Binary;
    readonly interactionPubKey: Binary;

    readonly wasCompressed: boolean;

    readonly events: NetEventDocument[];
    readonly receipt?: Binary;
    readonly receiptProofs?: string[];

    readonly gasUsed: Decimal128;
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
