import { OPNetTransactionTypes } from '../../../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { MessageType } from '../../../../enum/MessageType.js';
import { ThreadMessageBase } from '../../ThreadMessageBase.js';

export interface MempoolTransactionNotificationData {
    readonly txId: string;
    readonly transactionType: OPNetTransactionTypes;
}

export interface MempoolTransactionNotificationMessage
    extends ThreadMessageBase<MessageType.NOTIFY_MEMPOOL_TRANSACTION> {
    readonly data: MempoolTransactionNotificationData;
}
