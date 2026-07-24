import { describe, expect, it } from 'vitest';
import { Address, BufferHelper } from '@btc-vision/transaction';
import { StateMerkleTree } from '../../src/src/blockchain-indexer/processor/block/merkle/StateMerkleTree.js';

// H1: without binding the contract address into the state merkle leaf, a proof
// for (pointer, value) verifies regardless of which contract owns it, so a
// malicious full node can present contract A's (pointer, value) as contract B's.
// Binding the address, hash(address || pointer || value), defeats that. The
// binding is height-gated in production; here we drive both leaf formats directly.

function address(byte: number): Address {
    return new Address(new Uint8Array(32).fill(byte));
}

const POINTER = 42n;
const VALUE = 1000n;

function build(bindContractAddress: boolean): {
    root: string;
    proof: string[];
    victim: Address;
    attacker: Address;
    leafFor: (a: Address) => Uint8Array[];
} {
    const tree = new StateMerkleTree(bindContractAddress);
    const victim = address(0xaa);
    const attacker = address(0xbb);

    tree.updateValue(victim, POINTER, VALUE);
    tree.updateValue(attacker, 7n, 5n); // second entry so the tree has >= 2 leaves
    tree.freeze();

    const owned = tree.getValueWithProofs(victim, POINTER);
    if (!owned) {
        throw new Error('proof missing');
    }

    const [valueBytes, proof] = owned;
    const pointerBytes = BufferHelper.pointerToUint8Array(POINTER);

    // Reconstruct the leaf exactly as VMManager.verifyProofs does.
    const leafFor = (a: Address): Uint8Array[] =>
        bindContractAddress
            ? [new Uint8Array(a), pointerBytes, valueBytes]
            : [pointerBytes, valueBytes];

    return { root: tree.root, proof, victim, attacker, leafFor };
}

describe('state-proof contract-address binding (H1)', () => {
    it('legacy (address-less) leaf: a proof verifies for ANY contract, the forgery', () => {
        const { root, proof, victim, attacker, leafFor } = build(false);

        expect(StateMerkleTree.verify(root, leafFor(victim), proof)).toBe(true);
        // Same (pointer, value) accepted as the attacker's contract, this is H1.
        expect(StateMerkleTree.verify(root, leafFor(attacker), proof)).toBe(true);
    });

    it('bound leaf: the proof verifies only for the owning contract, forgery defeated', () => {
        const { root, proof, victim, attacker, leafFor } = build(true);

        expect(StateMerkleTree.verify(root, leafFor(victim), proof)).toBe(true);
        expect(StateMerkleTree.verify(root, leafFor(attacker), proof)).toBe(false);
    });
});
