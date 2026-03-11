import { BitcoinRPCThreadMessageType } from '../../../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { RPCMessageData } from './RPCMessage.js';

export interface TestMempoolAcceptRequest extends RPCMessageData<BitcoinRPCThreadMessageType.TEST_MEMPOOL_ACCEPT> {
    readonly rpcMethod: BitcoinRPCThreadMessageType.TEST_MEMPOOL_ACCEPT;
    readonly data: {
        readonly rawtxs: string[];
    };
}

export interface SubmitPackageRequest extends RPCMessageData<BitcoinRPCThreadMessageType.SUBMIT_PACKAGE> {
    readonly rpcMethod: BitcoinRPCThreadMessageType.SUBMIT_PACKAGE;
    readonly data: {
        readonly packageTxs: string[];
    };
}
