import { MessageType } from '../../../enum/MessageType.js';
import { ThreadTypes } from '../../../thread/enums/ThreadTypes.js';
import { ThreadMessageBase } from '../ThreadMessageBase.js';

export interface LinkThreadRequestData {
    readonly threadType: ThreadTypes;

    readonly targetThreadType: ThreadTypes;
    readonly targetThreadId: number;

    mainTargetThreadType: ThreadTypes | null;
    mainTargetThreadId: number | null;
}

export interface LinkThreadRequestMessage extends ThreadMessageBase<MessageType.LINK_THREAD_REQUEST> {
    readonly type: MessageType.LINK_THREAD_REQUEST;

    readonly data: LinkThreadRequestData;
}
