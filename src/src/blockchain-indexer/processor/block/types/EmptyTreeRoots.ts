/**
 * Empty Tree Roots
 * Computed once at module load from empty frozen MerkleTrees
 * These are the roots for blocks without OPNet transactions
 */

import { ReceiptMerkleTree } from '../merkle/ReceiptMerkleTree.js';
import { StateMerkleTree } from '../merkle/StateMerkleTree.js';

/**
 * Compute the empty receipt tree root by creating an empty tree and freezing it.
 * The freeze() method adds dummy values to meet minimum tree requirements.
 */
function computeEmptyReceiptRoot(): string {
    const tree = new ReceiptMerkleTree();
    tree.freeze();
    return tree.root;
}

/**
 * Compute the empty storage tree root by creating an empty tree and freezing it.
 * The freeze() method adds dummy values to meet minimum tree requirements.
 */
function computeEmptyStorageRoot(): string {
    const tree = new StateMerkleTree();
    tree.freeze();
    return tree.root;
}

// Compute once at module load
export const EMPTY_RECEIPT_ROOT: string = computeEmptyReceiptRoot();
export const EMPTY_STORAGE_ROOT: string = computeEmptyStorageRoot();
