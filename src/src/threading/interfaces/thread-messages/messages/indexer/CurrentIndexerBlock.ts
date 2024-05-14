import { MessageType } from '../../../../enum/MessageType.js';
import { IThreadData } from '../../../ThreadData.js';
import { ThreadMessageBase } from '../../ThreadMessageBase.js';

export interface CurrentIndexerBlockResponseData extends IThreadData {
    readonly blockNumber: bigint;
}

export interface BlockProcessedMessage
    extends ThreadMessageBase<MessageType.CURRENT_INDEXER_BLOCK> {
    readonly type: MessageType.CURRENT_INDEXER_BLOCK;

    readonly data: {};
}