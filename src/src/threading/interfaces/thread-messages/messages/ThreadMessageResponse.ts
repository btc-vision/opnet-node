import { MessageType } from '../../../enum/MessageType.js';
import { ThreadData } from '../../ThreadData.js';
import { ThreadMessageBase } from '../ThreadMessageBase.js';

export interface ThreadMessageResponse extends ThreadMessageBase<MessageType.THREAD_RESPONSE> {
    readonly type: MessageType.THREAD_RESPONSE;

    readonly data: ThreadData;
}
