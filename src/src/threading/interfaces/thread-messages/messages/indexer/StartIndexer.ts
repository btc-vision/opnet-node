import { MessageType } from '../../../../enum/MessageType.js';
import { ThreadMessageBase } from '../../ThreadMessageBase.js';

export interface StartIndexerResponseData {
    readonly started: boolean;
}

export interface StartIndexer extends ThreadMessageBase<MessageType.START_INDEXER> {
    readonly type: MessageType.START_INDEXER;

    readonly data: object;
}
