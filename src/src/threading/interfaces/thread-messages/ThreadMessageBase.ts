import { MessageType } from '../../enum/MessageType.js';
import { ThreadData } from '../ThreadData.js';

export interface ThreadMessageBase<T extends MessageType> {
    readonly type: T;

    taskId?: string;

    readonly toServer?: boolean;
    readonly data: ThreadData | PromiseLike<ThreadData>;
}
