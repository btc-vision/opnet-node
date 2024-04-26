import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

// (1)
const values = [
    [
        Buffer.from('JwPwGJuVWN9tmvkDRMOyjicG26fLnDiRcen9+IvjhVY=', 'base64'),
        [
            Buffer.from('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4=', 'base64'),
            Buffer.from('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4=', 'base64'),
        ],
    ],
    [
        Buffer.from('EXLK/QhEQMI5d9DrthLvozT+UcDQ7WuSPaz7g8GV3AQ=', 'base64'),
        Buffer.from('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4=', 'base64'),
    ],
];

// Generate fake values
for (let i = 0; i < 100; i++) {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const value = crypto.getRandomValues(new Uint8Array(32));

    values.push([Buffer.from(key), Buffer.from(value)]);
}

// (2)
const tree = StandardMerkleTree.of(values, ['bytes32', 'bytes32']);

// (3)
console.log('Merkle Root:', tree.root, tree.dump());

//const regeneratedTree = StandardMerkleTree.load();

for (const [i, v] of tree.entries()) {
    const proof = tree.getProof(i);

    const isValid = StandardMerkleTree.verify(tree.root, ['bytes32', 'bytes32'], v, proof);
    if (!isValid) {
        throw new Error(`Leaf ${i} is invalid`);
    }
}

console.log('All leaves are valid');
