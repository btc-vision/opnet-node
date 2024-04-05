import { MessageType } from '../../../../enum/MessageType.js';
import { ThreadMessageBase } from '../../ThreadMessageBase.js';

export interface GetCurrentBlockData {}

export interface GetCurrentBlockMessage extends ThreadMessageBase<MessageType.GET_CURRENT_BLOCK> {
    readonly type: MessageType.GET_CURRENT_BLOCK;

    readonly data: GetCurrentBlockData;
}
