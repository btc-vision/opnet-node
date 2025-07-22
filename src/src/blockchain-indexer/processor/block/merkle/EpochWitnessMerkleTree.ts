import { BinaryWriter } from '@btc-vision/transaction';
import { MerkleProof, MerkleTree as RustMerkleTree } from '@btc-vision/rust-merkle-tree';
import { toBytes } from './MerkleTree.js';
import { ZERO_HASH } from '../types/ZeroValue.js';

export enum AttestationType {
    EPOCH_WINNER = 0,
    BLOCK_WITNESS = 1,
    CONTINUOUS_WITNESS = 2,
}

export interface Attestation {
    type: AttestationType;
    blockNumber: bigint;
    checksumRoot: Buffer;
    identity: Buffer; // SHA512 of public key
    signature: Buffer; // Ed25519 signature
    timestamp: number;
    publicKey: Buffer;
    priority: number;
}

export interface EpochWinnerAttestation extends Attestation {
    epochNumber: bigint;
    matchingBits: number;
    salt: Buffer;
    solutionHash: Buffer;
    // Attestation about 4 epochs ago
    attestedEpochNumber: bigint;
    attestedStateRoot: Buffer;
}

export interface EpochData {
    epochNumber: bigint;
    startBlock: bigint;
    endBlock: bigint;
    checksumRoot: Buffer;
    stateRoot: Buffer;
    transactionRoot: Buffer;
    receiptRoot: Buffer;
    winner?: EpochWinnerAttestation;
}

// Interface for light client proofs
export interface EpochSummaryProof {
    epochNumber: bigint;
    attestationRoot: string;
    attestationCount: number;
    winner?: {
        publicKey: string;
        matchingBits: number;
        attestedEpochNumber: bigint;
        attestedStateRoot: string;
    };
    checksumRoot: string;
    stateRoot: string;
    transactionRoot: string;
    receiptRoot: string;
}

export class EpochMerkleTree {
    private tree: RustMerkleTree | undefined;
    private attestations: Attestation[] = [];
    private epochData: EpochData;
    private frozen: boolean = false;

    private readonly maxAttestations: number;

    constructor(epochData: EpochData, maxAttestations: number = 500000) {
        this.epochData = epochData;
        this.maxAttestations = maxAttestations;
    }

    public get root(): string {
        if (!this.tree) {
            throw new Error('[EpochMerkle] Tree not generated');
        }
        return this.tree.rootHex();
    }

    public static verifyAttestation(
        root: Buffer,
        attestation: Attestation,
        proof: string[],
    ): boolean {
        const attestationBytes = EpochMerkleTree.prototype.attestationToBytes.call(
            { epochData: { epochNumber: 0n } },
            attestation,
        );
        const merkleProof = new MerkleProof(proof.map((p) => toBytes(p)));
        return merkleProof.verify(root, RustMerkleTree.hash(attestationBytes));
    }

    public addWinnerAttestation(winner: EpochWinnerAttestation): void {
        if (this.frozen) {
            throw new Error('Epoch merkle tree is frozen');
        }

        // Verify the winner is for this epoch
        if (winner.epochNumber !== this.epochData.epochNumber) {
            throw new Error(
                `Winner epoch mismatch: expected ${this.epochData.epochNumber}, got ${winner.epochNumber}`,
            );
        }

        // Verify the attestation is about 4 epochs ago
        const expectedAttestedEpoch = this.epochData.epochNumber - 4n;
        if (winner.attestedEpochNumber !== expectedAttestedEpoch) {
            throw new Error(
                `Invalid attestation epoch: expected ${expectedAttestedEpoch}, got ${winner.attestedEpochNumber}`,
            );
        }

        // Winner has highest priority
        winner.priority = Infinity;
        winner.type = AttestationType.EPOCH_WINNER;

        this.attestations.push(winner);
        this.epochData.winner = winner;
    }

    public addBlockAttestation(attestation: Attestation): void {
        if (this.frozen) {
            throw new Error('Epoch merkle tree is frozen');
        }

        // Verify attestation is within epoch bounds
        if (
            attestation.blockNumber < this.epochData.startBlock ||
            attestation.blockNumber >= this.epochData.endBlock
        ) {
            throw new Error(
                `Block ${attestation.blockNumber} not in epoch ${this.epochData.epochNumber}`,
            );
        }

        attestation.type = AttestationType.BLOCK_WITNESS;
        attestation.priority = attestation.priority || 10;

        this.attestations.push(attestation);
    }

    public addContinuousAttestation(attestation: Attestation): void {
        if (this.frozen) {
            throw new Error('Epoch merkle tree is frozen');
        }

        attestation.type = AttestationType.CONTINUOUS_WITNESS;
        attestation.priority = attestation.priority || 5;

        this.attestations.push(attestation);
    }

    public generateTree(): void {
        if (this.frozen) {
            throw new Error('Epoch merkle tree is frozen');
        }

        // Sort attestations by priority (descending) and timestamp (descending)
        this.attestations.sort((a, b) => {
            if (a.priority !== b.priority) {
                // Handle Infinity priority for epoch winner
                if (a.priority === Infinity) return -1;
                if (b.priority === Infinity) return 1;
                return b.priority - a.priority;
            }
            return b.timestamp - a.timestamp;
        });

        // Take only up to maxAttestations
        const selectedAttestations = this.attestations.slice(0, this.maxAttestations);

        // If we have no attestations, add dummy values
        if (selectedAttestations.length === 0) {
            this.addDummyAttestations();
        }

        // Convert attestations to bytes for merkle tree
        const attestationBytes = selectedAttestations.map((att) => this.attestationToBytes(att));

        this.tree = new RustMerkleTree(attestationBytes);
    }

    public freeze(): void {
        this.generateTree();
        this.frozen = true;
    }

    public getProof(attestationIndex: number): string[] {
        if (!this.tree) {
            throw new Error('Tree not generated');
        }

        if (attestationIndex >= this.attestations.length) {
            throw new Error('Attestation index out of bounds');
        }

        const attestationBytes = this.attestationToBytes(this.attestations[attestationIndex]);
        return this.tree.getProof(this.tree.getIndexData(attestationBytes)).proofHashesHex();
    }

    public getEpochSummaryProof(): EpochSummaryProof {
        if (!this.tree) {
            throw new Error('Tree not generated');
        }

        return {
            epochNumber: this.epochData.epochNumber,
            attestationRoot: this.root,
            attestationCount: this.attestations.length,
            winner: this.epochData.winner
                ? {
                      publicKey: this.epochData.winner.publicKey.toString('hex'),
                      matchingBits: this.epochData.winner.matchingBits,
                      attestedEpochNumber: this.epochData.winner.attestedEpochNumber,
                      attestedStateRoot: this.epochData.winner.attestedStateRoot.toString('hex'),
                  }
                : undefined,
            checksumRoot: this.epochData.checksumRoot.toString('hex'),
            stateRoot: this.epochData.stateRoot.toString('hex'),
            transactionRoot: this.epochData.transactionRoot.toString('hex'),
            receiptRoot: this.epochData.receiptRoot.toString('hex'),
        };
    }

    public getAttestationCount(): number {
        return this.attestations.length;
    }

    public getAttestations(): Attestation[] {
        return [...this.attestations];
    }

    private attestationToBytes(attestation: Attestation): Uint8Array {
        const writer = new BinaryWriter(512); // Allocate enough space

        // Write common fields
        writer.writeU8(attestation.type);
        writer.writeU64(attestation.blockNumber);
        writer.writeBytes(attestation.checksumRoot);
        writer.writeBytes(attestation.identity);
        writer.writeBytes(attestation.signature);
        writer.writeU64(BigInt(attestation.timestamp));
        writer.writeBytes(attestation.publicKey);

        // Write type-specific fields
        if (attestation.type === AttestationType.EPOCH_WINNER) {
            const winner = attestation as EpochWinnerAttestation;
            writer.writeU64(winner.epochNumber);
            writer.writeU32(winner.matchingBits);
            writer.writeBytes(winner.salt);
            writer.writeBytes(winner.solutionHash);
            writer.writeU64(winner.attestedEpochNumber);
            writer.writeBytes(winner.attestedStateRoot);
        }

        return writer.getBuffer();
    }

    private addDummyAttestations(): void {
        // Add minimum attestations for tree generation
        const dummyAttestation1: Attestation = {
            type: AttestationType.CONTINUOUS_WITNESS,
            blockNumber: this.epochData.startBlock,
            checksumRoot: Buffer.from(ZERO_HASH, 'hex'),
            identity: Buffer.alloc(64, 0),
            signature: Buffer.alloc(64, 0),
            timestamp: 0,
            publicKey: Buffer.alloc(32, 0),
            priority: 0,
        };

        const dummyAttestation2: Attestation = {
            type: AttestationType.CONTINUOUS_WITNESS,
            blockNumber: this.epochData.endBlock - 1n,
            checksumRoot: Buffer.from(ZERO_HASH, 'hex'),
            identity: Buffer.alloc(64, 1),
            signature: Buffer.alloc(64, 1),
            timestamp: 1,
            publicKey: Buffer.alloc(32, 1),
            priority: 0,
        };

        this.attestations.push(dummyAttestation1, dummyAttestation2);
    }
}
