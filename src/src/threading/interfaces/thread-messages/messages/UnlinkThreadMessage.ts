import { MessageType } from '../../../enum/MessageType.js';
import { ThreadTypes } from '../../../thread/enums/ThreadTypes.js';
import { ThreadMessageBase } from '../ThreadMessageBase.js';

export interface UnlinkThreadData {
    readonly threadType: ThreadTypes;
    readonly threadId: number;
}

export interface UnlinkThreadMessage extends ThreadMessageBase<MessageType.UNLINK_THREAD> {
    readonly type: MessageType.UNLINK_THREAD;
    readonly data: UnlinkThreadData;
}
