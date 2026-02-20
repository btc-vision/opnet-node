import { BitcoinRPCThreadMessageType } from '../../../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { MessageType } from '../../../../enum/MessageType.js';
import { ThreadData } from '../../../ThreadData.js';
import { ThreadMessageBase } from '../../ThreadMessageBase.js';

export interface RPCMessageData<T extends BitcoinRPCThreadMessageType> {
    readonly rpcMethod: T;

    readonly data?: ThreadData | PromiseLike<ThreadData>;
}

export interface RPCMessage<
    T extends BitcoinRPCThreadMessageType,
> extends ThreadMessageBase<MessageType.RPC_METHOD> {
    readonly type: MessageType.RPC_METHOD;

    readonly data: RPCMessageData<T>;
}
