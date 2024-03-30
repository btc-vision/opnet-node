import { MessagePort } from 'worker_threads';
import { MessageType } from '../../../enum/MessageType.js';
import { ThreadMessageBase } from '../ThreadMessageBase.js';

export enum LinkType {
    RX,
    TX,
}

export interface LinkData<T extends LinkType> {
    readonly type: T;

    readonly port: MessagePort;
}

export interface LinkThreadMessage<T extends LinkType>
    extends ThreadMessageBase<MessageType.LINK_THREAD> {
    readonly type: MessageType.LINK_THREAD;

    readonly data: LinkData<T>;
}
