import { BitcoinRPCThreadMessageType } from '../../../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { BlockHeaderBlockDocument } from '../../../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { IBlockHeaderWitness } from '../../../../../poa/networking/protobuf/packets/blockchain/common/BlockHeaderWitness.js';
import { RPCMessageData } from './RPCMessage.js';

export interface BlockDataAtHeightData {
    readonly blockNumber: bigint;
    readonly blockHeader: IBlockHeaderWitness;
}

export interface ValidatedBlockHeader {
    readonly hasValidProofs: boolean | null;
    readonly storedBlockHeader: BlockHeaderBlockDocument | null;
}

export interface ValidateBlockHeaders
    extends RPCMessageData<BitcoinRPCThreadMessageType.VALIDATE_BLOCK_HEADERS> {
    readonly rpcMethod: BitcoinRPCThreadMessageType.VALIDATE_BLOCK_HEADERS;
    readonly data: BlockDataAtHeightData;
}
