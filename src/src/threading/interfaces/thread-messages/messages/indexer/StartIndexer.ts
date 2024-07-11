import { MessageType } from '../../../../enum/MessageType.js';
import { IThreadData } from '../../../ThreadData.js';
import { ThreadMessageBase } from '../../ThreadMessageBase.js';

export interface StartIndexerResponseData extends IThreadData {
    readonly started: boolean;
}

export interface StartIndexer extends ThreadMessageBase<MessageType.START_INDEXER> {
    readonly type: MessageType.START_INDEXER;

    readonly data: {};
}
