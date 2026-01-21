import { BitcoinRPCThreadMessageType } from '../../../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { BlockHeaderDocument } from '../../../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { IBlockHeaderWitness } from '../../../../../poc/networking/protobuf/packets/blockchain/common/BlockHeaderWitness.js';
import { RPCMessageData } from './RPCMessage.js';

export interface BlockDataAtHeightData {
    readonly blockNumber: bigint | string;
    readonly blockHeader: IBlockHeaderWitness;
}

export interface ValidatedBlockHeader {
    readonly hasValidProofs: boolean | null;
    readonly storedBlockHeader: BlockHeaderDocument | null;
}

export interface ValidateBlockHeaders
    extends RPCMessageData<BitcoinRPCThreadMessageType.VALIDATE_BLOCK_HEADERS> {
    readonly rpcMethod: BitcoinRPCThreadMessageType.VALIDATE_BLOCK_HEADERS;
    readonly data: BlockDataAtHeightData;
}
