import { Logger } from '@btc-vision/logger';
import { VMStorage } from '../../../vm/storage/VMStorage.js';
import { IndexingTask } from '../tasks/IndexingTask.js';
import { OPNetConsensus } from '../../../poa/configurations/OPNetConsensus.js';
import { SHA1 } from '../../../utils/SHA1.js';
import { IEpoch, IEpochDocument } from '../../../db/documents/interfaces/IEpochDocument.js';
import { DataConverter } from '@btc-vision/bsi-db';
import { Binary } from 'mongodb';
import { EpochDifficultyConverter } from '../../../poa/epoch/EpochDifficultyConverter.js';
import { EpochValidator } from '../../../poa/epoch/EpochValidator.js';
import {
    Attestation,
    AttestationType,
    EpochData,
    EpochMerkleTree,
} from '../block/merkle/EpochMerkleTree.js';
import {
    EpochSubmissionWinner,
    IEpochSubmissionsDocument,
} from '../../../db/documents/interfaces/IEpochSubmissionsDocument.js';
import { Address } from '@btc-vision/transaction';
import { Config } from '../../../config/Config.js';
import { IParsedBlockWitnessDocument } from '../../../db/models/IBlockWitnessDocument.js';
import { BlockHeaderDocument } from '../../../db/interfaces/IBlockHeaderBlockDocument.js';

interface EpochUpdateResult {
    readonly update: boolean;
    readonly currentEpoch: bigint;
}

interface AttestationEpoch {
    readonly root: Buffer;
    readonly epochNumber: bigint;
}

export class EpochManager extends Logger {
    public readonly logColor: string = '#009dff';

    private readonly epochValidator: EpochValidator;

    public constructor(private readonly storage: VMStorage) {
        super();

        this.epochValidator = new EpochValidator(this.storage);
    }

    public async updateEpoch(task: IndexingTask): Promise<void> {
        const currentHeight = task.tip;
        const epochsPerBlock = BigInt(OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH);

        // Check if we're at a block that finalizes an epoch
        // Epoch 0 (blocks 0-4) finalizes at block 5
        // Epoch 1 (blocks 5-9) finalizes at block 10
        // etc.
        if (currentHeight % epochsPerBlock === 0n && currentHeight > 0n) {
            // We're at the first block of a new epoch, finalize the previous one
            const epochToFinalize = currentHeight / epochsPerBlock - 1n;
            await this.finalizeEpochCompletion(task, epochToFinalize);
        }
    }

    private createEpoch(epoch: IEpoch): IEpochDocument {
        return {
            epochHash: new Binary(epoch.epochHash),
            epochRoot: new Binary(epoch.epochRoot),
            epochNumber: DataConverter.toDecimal128(
                epoch.startBlock / BigInt(OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH),
            ),
            targetHash: new Binary(epoch.targetHash),
            startBlock: DataConverter.toDecimal128(epoch.startBlock),
            endBlock: DataConverter.toDecimal128(
                epoch.startBlock + BigInt(OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH) - 1n,
            ),
            difficultyScaled: EpochDifficultyConverter.bitsToScaledDifficulty(
                epoch.solutionBits,
            ).toString(),
            proposer: {
                solution: new Binary(epoch.solution),
                publicKey: new Binary(epoch.publicKey),
                salt: new Binary(epoch.salt),
                graffiti: epoch.graffiti ? new Binary(epoch.graffiti) : undefined,
            },
            proofs: epoch.proofs.map((proof) => new Binary(proof)),
        };
    }

    private async getPreviousEpochHash(epochNumber: bigint): Promise<Buffer> {
        if (epochNumber === 0n) {
            return Buffer.alloc(32);
        }

        const epoch = await this.storage.getEpochByNumber(epochNumber - 1n);
        if (!epoch) {
            throw new Error(`No epoch found for number ${epochNumber - 1n}`);
        }

        return Buffer.from(epoch.epochHash.buffer);
    }

    private async finalizeEpochCompletion(task: IndexingTask, epochNumber: bigint): Promise<void> {
        const startBlock = epochNumber * BigInt(OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH);
        const endBlock = startBlock + BigInt(OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH) - 1n;

        // Get the target block for mining based on epoch number
        const miningTargetBlock = this.getMiningTargetBlock(epochNumber);

        // Load all the previous epoch data
        const [
            lastEpoch,
            attestationChecksumRoot,
            submissions,
            witnesses,
            checkSumRoots,
            miningTarget,
        ] = await Promise.all([
            this.getPreviousEpochHash(epochNumber),
            this.getAttestationChecksumRoot(epochNumber),

            // For epoch 0, no submissions (it can't be mined)
            epochNumber === 0n ? [] : this.storage.getSubmissionsByEpochNumber(epochNumber),
            this.storage.getWitnessesForEpoch(
                startBlock,
                endBlock,
                Config.EPOCH.MAX_ATTESTATION_PER_BLOCK,
            ),
            this.getChecksumRoots(startBlock, endBlock),
            this.getMiningTargetChecksum(miningTargetBlock),
        ]);

        return await this.finalizeEpoch(
            startBlock,
            endBlock,
            checkSumRoots,
            submissions,
            witnesses,
            task,
            epochNumber,
            lastEpoch,
            attestationChecksumRoot,
            miningTarget,
        );
    }

    private getMiningTargetBlock(epochNumber: bigint): bigint | null {
        // Epoch 0 has no mining target (can't be mined)
        if (epochNumber === 0n) {
            return null;
        }

        // Epoch 1 mines block 0 (first block of epoch 0)
        // Epoch 2 mines block 5 (first block of epoch 1)
        // Epoch 3 mines block 10 (first block of epoch 2)
        // etc.
        return epochNumber * BigInt(OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH) - 1n;
    }

    private async getMiningTargetChecksum(targetBlock: bigint | null): Promise<Buffer | null> {
        if (targetBlock === null) {
            return null;
        }

        const header = await this.storage.getBlockHeader(targetBlock);
        if (!header) {
            throw new Error(`No block header found for mining target block ${targetBlock}`);
        }

        const checksumRoot = Buffer.from(header.checksumRoot.replace('0x', ''), 'hex');
        if (checksumRoot.length !== 32) {
            throw new Error(
                `Invalid checksum root length: ${checksumRoot.length}. Expected 32 bytes.`,
            );
        }

        return checksumRoot;
    }

    private async getChecksumRoots(
        startBlock: bigint,
        endBlock: bigint,
    ): Promise<Map<bigint, Buffer>> {
        const promises: Promise<BlockHeaderDocument | undefined>[] = [];

        for (let blockNumber = startBlock; blockNumber <= endBlock; blockNumber++) {
            promises.push(this.storage.getBlockHeader(blockNumber));
        }

        const headers = await Promise.safeAll(promises);
        const checkSumRoots = new Map<bigint, Buffer>();

        for (const header of headers) {
            if (header) {
                const blockNumber = DataConverter.fromDecimal128(header.height);
                const checksumRoot = Buffer.from(header.checksumRoot.replace('0x', ''), 'hex');
                if (checksumRoot.length !== 32) {
                    throw new Error(
                        `Invalid checksum root length: ${checksumRoot.length}. Expected 32 bytes.`,
                    );
                }

                checkSumRoots.set(blockNumber, checksumRoot);
            }
        }

        return checkSumRoots;
    }

    private getBestSubmission(
        submissions: IEpochSubmissionsDocument[],
        targetHash: Buffer,
    ): EpochSubmissionWinner | null {
        if (submissions.length === 0) {
            return null;
        }

        // Find submission with highest difficulty (most matching bits)
        let bestSubmission: IEpochSubmissionsDocument | null = null;
        let bestMatchingBits = 0;

        for (const submission of submissions) {
            const solutionHash = Buffer.from(submission.epochProposed.solution.buffer);
            if (solutionHash.length !== 20) {
                this.log(
                    `Invalid solution hash length: ${solutionHash.length}. Expected 20 bytes.`,
                );
                continue;
            }

            const matchingBits = this.epochValidator.countMatchingBits(solutionHash, targetHash);
            if (matchingBits > bestMatchingBits) {
                bestMatchingBits = matchingBits;
                bestSubmission = submission;
            }
        }

        if (!bestSubmission) {
            return null;
        }

        return {
            epochNumber: DataConverter.fromDecimal128(bestSubmission.epochNumber),
            matchingBits: bestMatchingBits,
            salt: Buffer.from(bestSubmission.epochProposed.salt.buffer),
            publicKey: new Address(Buffer.from(bestSubmission.epochProposed.publicKey.buffer)),
            solutionHash: Buffer.from(bestSubmission.submissionHash.buffer),
            graffiti: bestSubmission.epochProposed.graffiti
                ? Buffer.from(bestSubmission.epochProposed.graffiti.buffer)
                : Buffer.alloc(OPNetConsensus.consensus.EPOCH.GRAFFITI_LENGTH),
        };
    }

    private async finalizeEpoch(
        startBlock: bigint,
        endBlock: bigint,
        checksumRoots: Map<bigint, Buffer>,
        submissions: IEpochSubmissionsDocument[],
        witnesses: IParsedBlockWitnessDocument[],
        task: IndexingTask,
        epochNumber: bigint,
        previousEpochHash: Buffer,
        attestationChecksumRoot: AttestationEpoch,
        miningTargetChecksum: Buffer | null,
    ): Promise<void> {
        // For epoch 0, there's no mining target
        let checksumRoot: Buffer;
        let targetHash: Buffer;

        if (epochNumber === 0n || !miningTargetChecksum) {
            // Epoch 0 can't be mined, use a zero hash
            checksumRoot = Buffer.alloc(32);
            targetHash = SHA1.hashBuffer(checksumRoot);
        } else {
            // Use the mining target checksum (from the first block of the previous epoch)
            checksumRoot = miningTargetChecksum;
            targetHash = SHA1.hashBuffer(checksumRoot);
        }

        const winningSubmission = this.getBestSubmission(submissions, targetHash);
        if (winningSubmission && winningSubmission.epochNumber !== epochNumber) {
            throw new Error(
                `Winner epoch mismatch: expected ${epochNumber}, got ${winningSubmission.epochNumber}`,
            );
        }

        let salt: Buffer;
        let publicKey: Address;
        let graffiti: Buffer;

        if (!winningSubmission || epochNumber === 0n) {
            // No valid submission or epoch 0, use genesis proposer
            salt = Buffer.alloc(32);
            publicKey = OPNetConsensus.consensus.EPOCH.GENESIS_PROPOSER_PUBLIC_KEY;
            graffiti = Buffer.alloc(OPNetConsensus.consensus.EPOCH.GRAFFITI_LENGTH);
        } else {
            salt = winningSubmission.salt;
            publicKey = winningSubmission.publicKey;
            graffiti = winningSubmission.graffiti;
        }

        if (salt.length !== 32) {
            throw new Error(`Invalid salt length: ${salt.length}. Expected 32 bytes.`);
        }

        const solution = EpochValidator.calculatePreimage(checksumRoot, publicKey, salt);
        const solutionHash = SHA1.hashBuffer(solution);
        const matchingBits = this.epochValidator.countMatchingBits(solutionHash, targetHash);

        const epochData: EpochData = {
            epochNumber: epochNumber,
            startBlock,
            endBlock,
            checksumRoot,
            previousEpochHash: previousEpochHash,
            attestedEpochNumber: attestationChecksumRoot.epochNumber,
            attestedChecksumRoot: attestationChecksumRoot.root,
        };

        const epoch = new EpochMerkleTree(epochData);

        // Create winner object
        const epochWinner: EpochSubmissionWinner = {
            epochNumber: epochNumber,
            publicKey: publicKey,
            solutionHash: solutionHash,
            salt: salt,
            matchingBits: matchingBits,
            graffiti: graffiti,
        };

        epoch.setWinner(epochWinner);

        // Add all the attestations for this epoch.
        for (const witness of witnesses) {
            const attestation = this.witnessToAttestation(witness, checksumRoots);
            if (!attestation) {
                continue;
            }

            epoch.addBlockAttestation(attestation);
        }

        epoch.freeze();

        const finalEpoch: IEpoch = {
            startBlock,
            endBlock,

            targetHash: targetHash,
            target: checksumRoot,

            solution: solutionHash,
            salt: salt,
            publicKey: publicKey.originalPublicKeyBuffer(),
            graffiti: graffiti,
            solutionBits: matchingBits,

            epochRoot: Buffer.from(epoch.rootBuffer),
            epochHash: epoch.epochHash,
            proofs: epoch.getEpochDataProof(), // Get proofs for this epoch
        };

        const epochDocument = this.createEpoch(finalEpoch);

        // Update the proofs for the witnesses
        await Promise.allSettled([
            this.storage.updateWitnessProofs(epoch.getAllAttestationProofs()),
            this.storage.saveEpoch(epochDocument),
        ]);

        if (Config.EPOCH.LOG_FINALIZATION) {
            this.debugBright(
                `Epoch ${epochNumber} finalized with root: ${epochDocument.epochRoot.toString('hex')} (Hash: ${epochDocument.epochHash.toString('hex')} | Difficulty: ${EpochDifficultyConverter.formatDifficulty(BigInt(epochDocument.difficultyScaled))}) | Winner: ${finalEpoch.publicKey.toString('hex')} | Solution: ${finalEpoch.solution.toString('hex')}) | Salt: ${finalEpoch.salt.toString('hex')} | Graffiti: ${finalEpoch.graffiti ? finalEpoch.graffiti.toString('hex') : 'None'}`,
            );
        }

        this.log(
            `!! -- Finalized epoch ${epochNumber} [${epochDocument.proposer.solution.toString('hex')} (Diff: ${EpochDifficultyConverter.formatDifficulty(BigInt(epochDocument.difficultyScaled))})] (${epochDocument.epochHash.toString('hex')}) -- !!`,
        );
    }

    private witnessToAttestation(
        witness: IParsedBlockWitnessDocument,
        checkSumRoots: Map<bigint, Buffer>,
    ): Attestation | null {
        const root = checkSumRoots.get(witness.blockNumber);
        if (!root) {
            throw new Error(`No checksum root found for block number ${witness.blockNumber}`);
        }

        if (!witness.publicKey) {
            this.warn(`Witness at block ${witness.blockNumber} has no public key`);

            return null;
        }

        return {
            type: AttestationType.BLOCK_WITNESS,
            blockNumber: witness.blockNumber,
            checksumRoot: root,
            signature: Buffer.from(witness.signature.buffer),
            timestamp: witness.timestamp.getTime(),
            publicKey: new Address(witness.publicKey.buffer),
        };
    }

    private async getAttestationChecksumRoot(epochNumber: bigint): Promise<AttestationEpoch> {
        const targetEpochNumber = epochNumber - 4n;
        if (epochNumber < 4n) {
            // For epochs 0-3, return zero hash as there's no history to attest to
            return {
                root: Buffer.alloc(32),
                epochNumber: targetEpochNumber,
            };
        }

        const targetEpoch = await this.storage.getEpochByNumber(targetEpochNumber);
        if (!targetEpoch) {
            throw new Error(
                `No epoch found for number ${targetEpochNumber}, cannot get attestation checksum root`,
            );
        }

        const endBlock = DataConverter.fromDecimal128(targetEpoch.endBlock);
        const blockHeader = await this.storage.getBlockHeader(endBlock); // Last block of epoch

        if (!blockHeader) {
            throw new Error(
                `No block header found for epoch end block ${endBlock}, cannot get attestation checksum root`,
            );
        }

        const root = Buffer.from(blockHeader.checksumRoot.replace('0x', ''), 'hex');
        if (root.length !== 32) {
            throw new Error(`Invalid checksum root length: ${root.length}. Expected 32 bytes.`);
        }

        return { root, epochNumber: targetEpochNumber };
    }

    private shouldUpdateEpoch(tip: bigint): EpochUpdateResult {
        const currentEpoch = tip / BigInt(OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH);
        const lastBlockEpoch = (tip - 1n) / BigInt(OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH);

        return {
            update: currentEpoch > lastBlockEpoch,
            currentEpoch: currentEpoch,
        };
    }
}
