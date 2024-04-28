import { ReceiptMerkleTree } from '../../blockchain-indexer/processor/block/merkle/ReceiptMerkleTree.js';
import { StateMerkleTree } from '../../blockchain-indexer/processor/block/merkle/StateMerkleTree.js';

export interface EvaluatedStates {
    storage: StateMerkleTree;
    receipts: ReceiptMerkleTree;
}
