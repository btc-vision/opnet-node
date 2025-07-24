import { Address, BinaryWriter } from '@btc-vision/transaction';
import { MerkleProof, MerkleTree as RustMerkleTree } from '@btc-vision/rust-merkle-tree';
import { toBytes } from './MerkleTree.js';
import { ZERO_HASH } from '../types/ZeroValue.js';
import { EpochSubmissionWinner } from '../../../../db/documents/interfaces/IEpochSubmissionsDocument.js';
import { OPNetConsensus } from '../../../../poa/configurations/OPNetConsensus.js';
import { NetworkConverter } from '../../../../config/network/NetworkConverter.js';
import { getChainId } from '../../../../vm/rust/ChainIdHex.js';
import { sha256 } from '@btc-vision/bitcoin';

export enum AttestationType {
    BLOCK_WITNESS = 0,
    EMPTY_ATTESTATION = 1,
}

export interface Attestation {
    readonly type: AttestationType;
    readonly blockNumber: bigint;
    readonly checksumRoot: Buffer;
    readonly signature: Buffer;
    readonly timestamp: number;
    readonly publicKey: Address;
}

export interface EpochData {
    readonly epochNumber: bigint;
    readonly startBlock: bigint;
    readonly endBlock: bigint;
    readonly checksumRoot: Buffer;
    readonly previousEpochHash: Buffer;

    // Attestation about 4 epochs ago
    readonly attestedEpochNumber: bigint;
    readonly attestedChecksumRoot: Buffer;

    winner?: EpochSubmissionWinner;
}

export interface EpochSummaryProof {
    readonly epochNumber: bigint;
    readonly attestationRoot: string;
    readonly attestationCount: number;
    readonly winner?: {
        readonly publicKey: string;
        readonly matchingBits: number;
        readonly salt: string;
        readonly solutionHash: string;
        readonly graffiti: string;
    };
    readonly checksumRoot: string;
    readonly previousEpochHash: string;
}

export interface EpochDataProof {
    readonly epochNumber: bigint;
    readonly startBlock: bigint;
    readonly endBlock: bigint;
    readonly checksumRoot: string;
    readonly previousEpochHash: string;
    readonly attestedEpochNumber: bigint;
    readonly attestedChecksumRoot: string;
    readonly winner?: {
        readonly publicKey: string;
        readonly matchingBits: number;
        readonly salt: string;
        readonly solutionHash: string;
        readonly graffiti: string;
    };
    readonly proof: string[];
    readonly leafHash: string;
    readonly rawBytes: string;
}

export interface AttestationProof {
    readonly attestation: {
        readonly type: AttestationType;
        readonly blockNumber: bigint;
        readonly checksumRoot: string;
        readonly signature: string;
        readonly timestamp: number;
        readonly publicKey: string;
    };
    readonly proof: string[];
    readonly leafHash: string;
    readonly index: number;
    readonly rawBytes: string;
}

export interface CompleteEpochMerkleTreeExport {
    readonly root: string;
    readonly hash: string;
    readonly epoch: EpochDataProof;
    readonly attestations: AttestationProof[];
    readonly metadata: {
        readonly chainId: string;
        readonly protocolId: string;
        readonly treeHeight: number;
        readonly leafCount: number;
        readonly generatedAt: number;
    };
}

export interface EpochTreeVerification {
    readonly root: string;
    readonly epochDataVerification: {
        readonly data: EpochDataProof;
        readonly isValid: boolean;
        readonly computedRoot: string;
    };
    readonly attestationVerifications: Array<{
        readonly attestation: AttestationProof;
        readonly isValid: boolean;
        readonly computedRoot: string;
    }>;
    readonly summary: {
        readonly allValid: boolean;
        readonly validCount: number;
        readonly totalCount: number;
    };
}

export interface AttestationVerificationProof {
    readonly root: string;
    readonly attestation: Attestation;
    readonly proof: string[];
}

const chainId = getChainId(NetworkConverter.networkToBitcoinNetwork(NetworkConverter.getNetwork()));

export class EpochMerkleTree {
    private tree: RustMerkleTree | undefined;
    private attestations: Attestation[] = [];
    private epochData: EpochData;
    private frozen: boolean = false;

    private readonly maxAttestations: number;

    constructor(epochData: EpochData, maxAttestations: number = 500_000) {
        this.epochData = epochData;
        this.maxAttestations = maxAttestations;
    }

    public get root(): string {
        if (!this.tree) {
            throw new Error('[EpochMerkle] Tree not generated');
        }

        return this.tree.rootHex();
    }

    public get rootBuffer(): Uint8Array {
        if (!this.tree) {
            throw new Error('[EpochMerkle] Tree not generated');
        }

        return this.tree.root();
    }

    private _epochHash: Buffer | undefined;

    public get epochHash(): Buffer {
        if (!this._epochHash) {
            throw new Error('Epoch hash not generated yet');
        }

        return this._epochHash;
    }

    public static verifyAttestation(
        root: Buffer | Uint8Array,
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

    public static verifyEpochData(root: Buffer, epochDataPackage: EpochDataProof): boolean {
        const merkleProof = new MerkleProof(epochDataPackage.proof.map((p) => toBytes(p)));
        const leafHash = Buffer.from(epochDataPackage.leafHash.replace('0x', ''), 'hex');
        return merkleProof.verify(root, leafHash);
    }

    public static verifyCompleteTree(
        treeExport: CompleteEpochMerkleTreeExport,
    ): EpochTreeVerification {
        const root = Buffer.from(treeExport.root.replace('0x', ''), 'hex');

        // Verify epoch data
        const epochDataValid = EpochMerkleTree.verifyEpochData(root, treeExport.epoch);
        const epochDataRoot = new MerkleProof(
            treeExport.epoch.proof.map((p) => toBytes(p)),
        ).rootHex(Buffer.from(treeExport.epoch.leafHash.replace('0x', ''), 'hex'));

        // Verify all attestations
        const attestationVerifications = treeExport.attestations.map((attPackage) => {
            const attestation: Attestation = {
                type: attPackage.attestation.type,
                blockNumber: attPackage.attestation.blockNumber,
                checksumRoot: Buffer.from(
                    attPackage.attestation.checksumRoot.replace('0x', ''),
                    'hex',
                ),
                signature: Buffer.from(attPackage.attestation.signature.replace('0x', ''), 'hex'),
                timestamp: attPackage.attestation.timestamp,
                publicKey: Address.fromString(attPackage.attestation.publicKey),
            };

            const isValid = EpochMerkleTree.verifyAttestation(root, attestation, attPackage.proof);
            const computedRoot = new MerkleProof(attPackage.proof.map((p) => toBytes(p))).rootHex(
                Buffer.from(attPackage.leafHash.replace('0x', ''), 'hex'),
            );

            return {
                attestation: attPackage,
                isValid,
                computedRoot,
            };
        });

        const validCount =
            attestationVerifications.filter((v) => v.isValid).length + (epochDataValid ? 1 : 0);

        const totalCount = attestationVerifications.length + 1;
        return {
            root: treeExport.root,
            epochDataVerification: {
                data: treeExport.epoch,
                isValid: epochDataValid,
                computedRoot: epochDataRoot,
            },
            attestationVerifications,
            summary: {
                allValid: validCount === totalCount,
                validCount,
                totalCount,
            },
        };
    }

    public setWinner(winner: EpochSubmissionWinner): void {
        if (this.frozen) {
            throw new Error('Epoch merkle tree is frozen');
        }

        this.epochData.winner = winner;
    }

    public addBlockAttestation(attestation: Attestation): void {
        if (this.frozen) {
            throw new Error('Epoch merkle tree is frozen');
        }

        // Verify attestation is within epoch bounds
        if (
            attestation.blockNumber < this.epochData.startBlock ||
            attestation.blockNumber > this.epochData.endBlock
        ) {
            throw new Error(
                `Block ${attestation.blockNumber} not in epoch ${this.epochData.epochNumber}`,
            );
        }

        this.attestations.push({
            ...attestation,
            type: AttestationType.BLOCK_WITNESS,
        });
    }

    public generateTree(): void {
        if (this.frozen) {
            throw new Error('Epoch merkle tree is frozen');
        }

        // Sort attestations by timestamp (descending)
        this.attestations.sort((a, b) => b.timestamp - a.timestamp);

        // If we have no attestations, add dummy values
        if (this.attestations.length < 2) {
            this.addDummyAttestations();
        }

        // Take only up to maxAttestations
        const selectedAttestations = this.attestations.slice(0, this.maxAttestations);

        // Create array of bytes for merkle tree
        const treeLeaves: Uint8Array[] = [];

        const epochDataBytes = this.epochDataToBytes();
        this._epochHash = sha256(Buffer.from(epochDataBytes));

        // Add epoch data as the first leaf
        treeLeaves.push(epochDataBytes);

        // Add attestations as subsequent leaves
        const attestationBytes = selectedAttestations.map((att) => this.attestationToBytes(att));
        treeLeaves.push(...attestationBytes);

        this.tree = new RustMerkleTree(treeLeaves);
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

        // Note: attestationIndex 0 corresponds to tree index 1 (since epoch data is at index 0)
        const attestationBytes = this.attestationToBytes(this.attestations[attestationIndex]);
        return this.tree.getProof(this.tree.getIndexData(attestationBytes)).proofHashesHex();
    }

    public getEpochDataProof(): string[] {
        if (!this.tree) {
            throw new Error('Tree not generated');
        }

        const epochDataBytes = this.epochDataToBytes();
        return this.tree.getProof(this.tree.getIndexData(epochDataBytes)).proofHashesHex();
    }

    public getEpochDataProofPackage(): EpochDataProof {
        if (!this.tree) {
            throw new Error('Tree not generated');
        }

        const epochDataBytes = this.epochDataToBytes();
        const proof = this.getEpochDataProof();
        const leafHash = RustMerkleTree.hash(epochDataBytes);

        return {
            epochNumber: this.epochData.epochNumber,
            startBlock: this.epochData.startBlock,
            endBlock: this.epochData.endBlock,
            checksumRoot: this.epochData.checksumRoot.toString('hex'),
            previousEpochHash: this.epochData.previousEpochHash.toString('hex'),
            attestedEpochNumber: this.epochData.attestedEpochNumber,
            attestedChecksumRoot: this.epochData.attestedChecksumRoot.toString('hex'),
            winner: this.epochData.winner
                ? {
                      publicKey: this.epochData.winner.publicKey.toHex(),
                      matchingBits: this.epochData.winner.matchingBits,
                      salt: this.epochData.winner.salt.toString('hex'),
                      solutionHash: this.epochData.winner.solutionHash.toString('hex'),
                      graffiti: this.epochData.winner.graffiti.toString('hex'),
                  }
                : undefined,
            proof,
            leafHash: '0x' + Buffer.from(leafHash).toString('hex'),
            rawBytes: '0x' + Buffer.from(epochDataBytes).toString('hex'),
        };
    }

    public getAttestationProofPackage(attestationIndex: number): AttestationProof {
        if (!this.tree) {
            throw new Error('Tree not generated');
        }

        if (attestationIndex >= this.attestations.length) {
            throw new Error('Attestation index out of bounds');
        }

        const attestation = this.attestations[attestationIndex];
        const attestationBytes = this.attestationToBytes(attestation);
        const proof = this.getProof(attestationIndex);
        const leafHash = RustMerkleTree.hash(attestationBytes);

        return {
            attestation: {
                type: attestation.type,
                blockNumber: attestation.blockNumber,
                checksumRoot: attestation.checksumRoot.toString('hex'),
                signature: attestation.signature.toString('hex'),
                timestamp: attestation.timestamp,
                publicKey: attestation.publicKey.toHex(),
            },
            proof,
            leafHash: '0x' + Buffer.from(leafHash).toString('hex'),
            index: attestationIndex,
            rawBytes: '0x' + Buffer.from(attestationBytes).toString('hex'),
        };
    }

    public getAllAttestationProofPackages(): AttestationProof[] {
        if (!this.tree) {
            throw new Error('Tree not generated');
        }

        return this.attestations.map((_, index) => this.getAttestationProofPackage(index));
    }

    public exportCompleteTree(): CompleteEpochMerkleTreeExport {
        if (!this.tree) {
            throw new Error('Tree not generated');
        }

        return {
            root: this.root,
            hash: '0x' + this.epochHash.toString('hex'),
            epoch: this.getEpochDataProofPackage(),
            metadata: {
                chainId: '0x' + Buffer.from(chainId).toString('hex'),
                protocolId:
                    '0x' + Buffer.from(OPNetConsensus.consensus.PROTOCOL_ID).toString('hex'),
                treeHeight: Math.ceil(Math.log2(this.attestations.length + 1)),
                leafCount: this.attestations.length + 1,
                generatedAt: Date.now(),
            },
            attestations: this.getAllAttestationProofPackages(),
        };
    }

    public verifyProof(leafData: Uint8Array, proof: string[]): boolean {
        if (!this.tree) {
            throw new Error('Tree not generated');
        }

        const merkleProof = new MerkleProof(proof.map((p) => toBytes(p)));
        return merkleProof.verify(this.rootBuffer, RustMerkleTree.hash(leafData));
    }

    public getAttestationVerificationData(attestationIndex: number): AttestationVerificationProof {
        if (!this.tree) {
            throw new Error('Tree not generated');
        }

        const attestation = this.attestations[attestationIndex];
        const proof = this.getProof(attestationIndex);

        return {
            root: this.root,
            attestation: { ...attestation },
            proof,
        };
    }

    public getTreeStatistics(): {
        totalLeaves: number;
        attestationCount: number;
        treeHeight: number;
        root: string;
        hasWinner: boolean;
        attestationTypes: { [key: number]: number };
    } {
        if (!this.tree) {
            throw new Error('Tree not generated');
        }

        const attestationTypes: { [key: number]: number } = {};
        this.attestations.forEach((att) => {
            attestationTypes[att.type] = (attestationTypes[att.type] || 0) + 1;
        });

        return {
            totalLeaves: this.attestations.length + 1,
            attestationCount: this.attestations.length,
            treeHeight: Math.ceil(Math.log2(this.attestations.length + 1)),
            root: this.root,
            hasWinner: !!this.epochData.winner,
            attestationTypes,
        };
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
                      publicKey: this.epochData.winner.publicKey.toHex(),
                      matchingBits: this.epochData.winner.matchingBits,
                      salt: this.epochData.winner.salt.toString('hex'),
                      solutionHash: this.epochData.winner.solutionHash.toString('hex'),
                      graffiti: this.epochData.winner.graffiti.toString('hex'),
                  }
                : undefined,
            checksumRoot: this.epochData.checksumRoot.toString('hex'),
            previousEpochHash: this.epochData.previousEpochHash.toString('hex'),
        };
    }

    private epochDataToBytes(): Uint8Array {
        const baseSize = 64 + 8 + 8 + 8 + 32 + 32 + 8 + 32;
        const winnerSize = this.epochData.winner
            ? 32 + 2 + 32 + 32 + OPNetConsensus.consensus.EPOCH.GRAFFITI_LENGTH
            : 0;

        const writer = new BinaryWriter(baseSize + winnerSize);

        // Protocol information
        writer.writeBytes(chainId);
        writer.writeBytes(OPNetConsensus.consensus.PROTOCOL_ID);

        // Write epoch data fields
        writer.writeU64(this.epochData.epochNumber); // 8
        writer.writeU64(this.epochData.startBlock); // 8
        writer.writeU64(this.epochData.endBlock); // 8
        writer.writeBytes(this.epochData.checksumRoot); // 32
        writer.writeBytes(this.epochData.previousEpochHash); // 32
        writer.writeU64(this.epochData.attestedEpochNumber); // 8
        writer.writeBytes(this.epochData.attestedChecksumRoot); // 32

        // Write winner data if present
        if (this.epochData.winner) {
            if (
                this.epochData.winner.graffiti.length !==
                OPNetConsensus.consensus.EPOCH.GRAFFITI_LENGTH
            ) {
                throw new Error(
                    `Invalid graffiti length: expected ${OPNetConsensus.consensus.EPOCH.GRAFFITI_LENGTH}, got ${this.epochData.winner.graffiti.length}`,
                );
            }

            writer.writeAddress(this.epochData.winner.publicKey); // 32
            writer.writeU16(this.epochData.winner.matchingBits & 0xffff); // 2
            writer.writeBytes(this.epochData.winner.salt); // 32
            writer.writeBytes(this.epochData.winner.solutionHash); // 32
            writer.writeBytes(this.epochData.winner.graffiti); // OPNetConsensus.consensus.EPOCH.GRAFFITI_LENGTH
        }

        return writer.getBuffer();
    }

    private attestationToBytes(attestation: Attestation): Uint8Array {
        const writer = new BinaryWriter(145);

        // Write attestation fields
        writer.writeU8(attestation.type); // 1
        writer.writeU64(attestation.blockNumber); // 8
        writer.writeBytes(attestation.checksumRoot); // 32
        writer.writeBytes(attestation.signature); // 64
        writer.writeU64(BigInt(attestation.timestamp)); // 8
        writer.writeAddress(attestation.publicKey); // 32

        return writer.getBuffer();
    }

    private addDummyAttestations(): void {
        // Add minimum attestations for tree generation
        const dummyAttestation1: Attestation = {
            type: AttestationType.EMPTY_ATTESTATION,
            blockNumber: this.epochData.startBlock,
            checksumRoot: Buffer.from(ZERO_HASH, 'hex'),
            signature: Buffer.alloc(64, 0),
            timestamp: 0,
            publicKey: Address.dead(),
        };

        const dummyAttestation2: Attestation = {
            type: AttestationType.EMPTY_ATTESTATION,
            blockNumber: this.epochData.endBlock - 1n,
            checksumRoot: Buffer.from(ZERO_HASH, 'hex'),
            signature: Buffer.alloc(64, 1),
            timestamp: 1,
            publicKey: Address.dead(),
        };

        this.attestations.push(dummyAttestation1, dummyAttestation2);
    }
}
