import { ChecksumProof } from '../../../../../poa/networking/protobuf/packets/blockchain/common/BlockHeaderWitness.js';
import { MessageType } from '../../../../enum/MessageType.js';
import { ThreadMessageBase } from '../../ThreadMessageBase.js';

export interface BlockProcessedData {
    readonly blockNumber: bigint;
    readonly blockHash: string;
    readonly previousBlockHash?: string;

    readonly merkleRoot: string;
    readonly receiptRoot: string;
    readonly storageRoot: string;

    readonly checksumHash: string;
    readonly checksumProofs: ChecksumProof[];
    readonly previousBlockChecksum: string;

    readonly txCount: number;
}

export interface BlockProcessedMessage extends ThreadMessageBase<MessageType.BLOCK_PROCESSED> {
    readonly type: MessageType.BLOCK_PROCESSED;

    readonly data: BlockProcessedData;
}
