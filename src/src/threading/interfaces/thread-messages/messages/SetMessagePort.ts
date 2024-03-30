import { MessagePort } from 'worker_threads';
import { MessageType } from '../../../enum/MessageType.js';
import { ThreadMessageBase } from '../ThreadMessageBase.js';

export interface SetMessagePort extends ThreadMessageBase<MessageType.SET_MESSAGE_PORT> {
    readonly type: MessageType.SET_MESSAGE_PORT;

    readonly data: MessagePort;
}
