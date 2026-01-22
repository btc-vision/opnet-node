import { Logger } from '@btc-vision/logger';
import { VMStorage } from '../../../vm/storage/VMStorage.js';
import { IndexingTask } from '../tasks/IndexingTask.js';
import { OPNetConsensus } from '../../../poc/configurations/OPNetConsensus.js';
import { SHA1 } from '../../../utils/SHA1.js';
import { IEpoch, IEpochDocument } from '../../../db/documents/interfaces/IEpochDocument.js';
import { DataConverter } from '@btc-vision/bsi-common';
import { Binary } from 'mongodb';
import { EpochDifficultyConverter } from '../../../poc/epoch/EpochDifficultyConverter.js';
import { EpochValidator } from '../../../poc/epoch/EpochValidator.js';
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
import { Submission } from '../transaction/features/Submission.js';
import { PendingTargetEpoch } from '../../../db/documents/interfaces/ITargetEpochDocument.js';
import { ThreadTypes } from '../../../threading/thread/enums/ThreadTypes.js';
import { ThreadMessageBase } from '../../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { MessageType } from '../../../threading/enum/MessageType.js';
import { ThreadData } from '../../../threading/interfaces/ThreadData.js';

export interface ValidatedSolutionResult {
    readonly valid: boolean;
    readonly matchingBits: number;
    readonly hash: Buffer;
}

interface AttestationEpoch {
    readonly root: Buffer;
    readonly epochNumber: bigint;
}

const GENESIS_SALT = Buffer.alloc(32).fill(255);

export class EpochManager extends Logger {
    public readonly logColor: string = '#009dff';

    private readonly epochValidator: EpochValidator;

    public constructor(private readonly storage: VMStorage) {
        super();

        this.epochValidator = new EpochValidator(this.storage);
    }

    /**
     * Callback to send messages to other threads
     * Assigned by BlockIndexer
     */
    public sendMessageToThread: (
        type: ThreadTypes,
        message: ThreadMessageBase<MessageType>,
    ) => Promise<ThreadData | null> = () => {
        throw new Error('sendMessageToThread not implemented.');
    };

    public async updateEpoch(task: IndexingTask): Promise<void> {
        const currentHeight = task.tip;
        const epochsPerBlock = OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH;

        // Check if we're at a block that finalizes an epoch
        // Epoch 0 (blocks 0-4) finalizes at block 5
        // Epoch 1 (blocks 5-9) finalizes at block 10
        if (currentHeight % epochsPerBlock === 0n && currentHeight > 0n) {
            // We are at the first block of a new epoch, finalize the previous one
            const epochToFinalize = currentHeight / epochsPerBlock - 1n;

            // Dispatch onEpochChange hook - epoch number has changed
            const newEpochNumber = currentHeight / epochsPerBlock;
            const newEpochStartBlock = newEpochNumber * epochsPerBlock;
            const newEpochEndBlock = newEpochStartBlock + epochsPerBlock - 1n;

            await this.dispatchEpochChange({
                epochNumber: newEpochNumber,
                startBlock: newEpochStartBlock,
                endBlock: newEpochEndBlock,
            });

            await this.finalizeEpochCompletion(epochToFinalize);
        }
    }

    public async submissionExists(
        epochNumber: bigint,
        salt: Buffer,
        mldsaPublicKey: Buffer | Binary,
    ): Promise<boolean> {
        return this.storage.submissionExists(mldsaPublicKey, salt, epochNumber);
    }

    public async getPendingEpochTarget(currentEpoch: bigint): Promise<PendingTargetEpoch> {
        if (currentEpoch === 0n) {
            const target = Buffer.alloc(32);
            return {
                checksumRoot: target,
                targetHash: SHA1.hashBuffer(target),
                nextEpochNumber: 0n,
            };
        }

        return await this.epochValidator.getEpochData(currentEpoch);
    }

    public validateEpochSubmission(
        submission: Submission,
        blockHeight: bigint,
        pendingTarget: PendingTargetEpoch,
    ): ValidatedSolutionResult {
        const currentEpoch = blockHeight / OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH;

        // Epoch 0 cannot be mined
        if (currentEpoch === 0n) {
            return {
                valid: false,
                matchingBits: 0,
                hash: Buffer.alloc(0),
            };
        }

        if (pendingTarget.nextEpochNumber !== currentEpoch) {
            return {
                valid: false,
                matchingBits: 0,
                hash: Buffer.alloc(0),
            };
        }

        // Reuse the static calculatePreimage method from EpochValidator
        const preimage = EpochValidator.calculatePreimage(
            pendingTarget.checksumRoot,
            submission.mldsaPublicKey,
            submission.salt,
        );

        // Calculate SHA-1 of the preimage
        const hash = SHA1.hashBuffer(preimage);

        // Reuse the countMatchingBits method from epochValidator instance
        const matchingBits = this.epochValidator.countMatchingBits(hash, pendingTarget.targetHash);

        // Check minimum difficulty
        const minDifficulty = OPNetConsensus.consensus.EPOCH.MIN_DIFFICULTY || 20;
        if (matchingBits < minDifficulty) {
            return {
                valid: false,
                matchingBits,
                hash,
            };
        }

        // Validate salt length
        if (submission.salt.length !== 32) {
            return {
                valid: false,
                matchingBits,
                hash,
            };
        }

        // Validate graffiti length if provided
        if (
            submission.graffiti &&
            submission.graffiti.length > OPNetConsensus.consensus.EPOCH.GRAFFITI_LENGTH
        ) {
            return {
                valid: false,
                matchingBits,
                hash,
            };
        }

        return {
            valid: true,
            matchingBits,
            hash,
        };
    }

    public async finalizeEpochCompletion(epochNumber: bigint): Promise<void> {
        if (!OPNetConsensus.consensus.EPOCH.ENABLED) {
            return;
        }

        const startBlock = epochNumber * OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH;
        const endBlock = startBlock + OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH - 1n;

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
        ] = await Promise.safeAll([
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
            //task,
            epochNumber,
            lastEpoch,
            attestationChecksumRoot,
            miningTarget,
        );
    }

    private createEpoch(epoch: IEpoch): IEpochDocument {
        return {
            epochHash: new Binary(epoch.epochHash),
            epochRoot: new Binary(epoch.epochRoot),
            epochNumber: DataConverter.toDecimal128(
                epoch.startBlock / OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH,
            ),
            targetHash: new Binary(epoch.targetHash),
            startBlock: DataConverter.toDecimal128(epoch.startBlock),
            endBlock: DataConverter.toDecimal128(
                epoch.startBlock + OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH - 1n,
            ),
            difficultyScaled: EpochDifficultyConverter.bitsToScaledDifficulty(
                epoch.solutionBits,
            ).toString(),
            proposer: {
                solution: new Binary(epoch.solution),
                mldsaPublicKey: new Binary(epoch.mldsaPublicKey),
                legacyPublicKey: new Binary(epoch.legacyPublicKey),
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

    private getMiningTargetBlock(epochNumber: bigint): bigint | null {
        if (epochNumber === 0n) {
            return null;
        }

        // CHANGE: For 1-epoch delay, we mine based on the last block of the previous epoch
        // Epoch 1 mines block 4 (last block of epoch 0)
        // Epoch 2 mines block 9 (last block of epoch 1)
        // Epoch 3 mines block 14 (last block of epoch 2)
        // etc.

        // mine the last block of the immediately previous epoch
        return epochNumber * OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH - 1n;
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
        let bestSubmissions: IEpochSubmissionsDocument[] = [];
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
            if (matchingBits === bestMatchingBits) {
                bestSubmissions.push(submission);
            } else if (matchingBits > bestMatchingBits) {
                bestMatchingBits = matchingBits;
                bestSubmissions = [submission];
            }
        }

        if (bestSubmissions.length === 0) {
            return null;
        }

        const winningSubmission = this.getWinningSubmission(bestSubmissions, targetHash);
        return {
            epochNumber: DataConverter.fromDecimal128(winningSubmission.epochNumber),
            matchingBits: bestMatchingBits,
            salt: Buffer.from(winningSubmission.epochProposed.salt.buffer),
            mldsaPublicKey: Buffer.from(winningSubmission.epochProposed.mldsaPublicKey.buffer),
            legacyPublicKey: Buffer.from(winningSubmission.epochProposed.legacyPublicKey.buffer),
            solutionHash: Buffer.from(winningSubmission.submissionHash.buffer),
            graffiti: winningSubmission.epochProposed.graffiti
                ? Buffer.from(winningSubmission.epochProposed.graffiti.buffer)
                : Buffer.alloc(OPNetConsensus.consensus.EPOCH.GRAFFITI_LENGTH),
        };
    }

    private getWinningSubmission(
        submissions: IEpochSubmissionsDocument[],
        targetHash: Buffer,
    ): IEpochSubmissionsDocument {
        const winner = [...submissions].sort((a, b) => {
            // Compare public keys (without pairing byte) - lower wins
            const aPublicKey = Buffer.from(a.epochProposed.mldsaPublicKey.buffer);
            const bPublicKey = Buffer.from(b.epochProposed.mldsaPublicKey.buffer);

            if (aPublicKey.length < 32 || bPublicKey.length < 32) {
                throw new Error('Invalid public key length for comparison tiebreaker.');
            }

            const pubKeyComparison = aPublicKey.compare(bPublicKey);
            if (pubKeyComparison !== 0) {
                return pubKeyComparison; // Lower public key wins
            }

            // Submission tx hash - lower wins
            const aTxHash = Buffer.from(a.submissionTxHash.buffer);
            const bTxHash = Buffer.from(b.submissionTxHash.buffer);

            const hashCompare = aTxHash.compare(bTxHash);
            if (hashCompare !== 0) {
                return hashCompare; // Lower tx hash wins
            }

            // If public keys are equal, use public key matching bits as secondary tiebreaker
            // This adds an element of "mining luck" even among equal solutions
            const aPublicKeySlice = aPublicKey.subarray(12); // Last 20 bytes
            const bPublicKeySlice = bPublicKey.subarray(12);

            if (aPublicKeySlice.length === 20 && bPublicKeySlice.length === 20) {
                const aPublicKeyBits = this.epochValidator.countMatchingBits(
                    aPublicKeySlice,
                    targetHash,
                );

                const bPublicKeyBits = this.epochValidator.countMatchingBits(
                    bPublicKeySlice,
                    targetHash,
                );

                if (aPublicKeyBits !== bPublicKeyBits) {
                    return bPublicKeyBits - aPublicKeyBits; // Higher matching bits wins
                }
            } else {
                throw new Error('Invalid public key length for tiebreaker comparison.');
            }

            // Compare salts - lower wins
            const aSalt = Buffer.from(a.epochProposed.salt.buffer);
            const bSalt = Buffer.from(b.epochProposed.salt.buffer);
            const saltComparison = aSalt.compare(bSalt);
            if (saltComparison !== 0) {
                return saltComparison; // Lower salt wins
            }

            // Finally, submission tx id - lower wins
            const aTxId = Buffer.from(a.submissionTxId.buffer);
            const bTxId = Buffer.from(b.submissionTxId.buffer);

            return aTxId.compare(bTxId); // Lower tx id wins
        })[0];

        if (!winner) {
            throw new Error('No winning submission found after evaluation.');
        }

        return winner;
    }

    private async finalizeEpoch(
        startBlock: bigint,
        endBlock: bigint,
        checksumRoots: Map<bigint, Buffer>,
        submissions: IEpochSubmissionsDocument[],
        witnesses: IParsedBlockWitnessDocument[],
        epochNumber: bigint,
        previousEpochHash: Buffer,
        attestationChecksumRoot: AttestationEpoch,
        miningTargetChecksum: Buffer | null,
    ): Promise<void> {
        // For epoch 0, there's no mining target
        let checksumRoot: Buffer;

        if (epochNumber === 0n || !miningTargetChecksum) {
            // Epoch 0 can't be mined, use a zero hash
            checksumRoot = Buffer.alloc(32);
        } else {
            // Use the mining target checksum (from the first block of the previous epoch)
            checksumRoot = miningTargetChecksum;
        }

        const targetHash: Buffer = SHA1.hashBuffer(checksumRoot);

        const winningSubmission = this.getBestSubmission(submissions, targetHash);
        if (winningSubmission && winningSubmission.epochNumber !== epochNumber) {
            throw new Error(
                `Winner epoch mismatch: expected ${epochNumber}, got ${winningSubmission.epochNumber}`,
            );
        }

        let salt: Buffer;
        let mldsaPublicKey: Buffer;
        let legacyPublicKey: Buffer;
        let graffiti: Buffer;

        if (!winningSubmission || epochNumber === 0n) {
            // No valid submission or epoch 0, use genesis proposer
            salt = GENESIS_SALT; // All 0xFF for genesis
            mldsaPublicKey = OPNetConsensus.consensus.EPOCH.GENESIS_PROPOSER_PUBLIC_KEY.toBuffer();
            legacyPublicKey =
                OPNetConsensus.consensus.EPOCH.GENESIS_PROPOSER_PUBLIC_KEY.originalPublicKeyBuffer();
            graffiti = Buffer.alloc(OPNetConsensus.consensus.EPOCH.GRAFFITI_LENGTH);
        } else {
            salt = winningSubmission.salt;
            mldsaPublicKey = winningSubmission.mldsaPublicKey;
            legacyPublicKey = winningSubmission.legacyPublicKey;
            graffiti = winningSubmission.graffiti;
        }

        if (salt.length !== 32) {
            throw new Error(`Invalid salt length: ${salt.length}. Expected 32 bytes.`);
        }

        const solution = EpochValidator.calculatePreimage(checksumRoot, mldsaPublicKey, salt);
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
            mldsaPublicKey: mldsaPublicKey,
            legacyPublicKey: legacyPublicKey,
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
            mldsaPublicKey: mldsaPublicKey,
            legacyPublicKey: legacyPublicKey,
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
            this.storage.deleteOldTargetEpochs(epochNumber),
        ]);

        if (Config.EPOCH.LOG_FINALIZATION) {
            this.debugBright(
                `Epoch ${epochNumber} finalized with root: ${epochDocument.epochRoot.toString('hex')} (Hash: ${epochDocument.epochHash.toString('hex')} | Difficulty: ${EpochDifficultyConverter.formatDifficulty(BigInt(epochDocument.difficultyScaled))}) | Winner: ${finalEpoch.mldsaPublicKey.toString('hex')} | Solution: ${finalEpoch.solution.toString('hex')}) | Salt: ${finalEpoch.salt.toString('hex')} | Graffiti: ${finalEpoch.graffiti ? finalEpoch.graffiti.toString('hex') : 'None'}`,
            );
        }

        this.log(
            `!! -- Finalized epoch ${epochNumber} [${epochDocument.proposer.solution.toString('hex')} (Diff: ${EpochDifficultyConverter.formatDifficulty(BigInt(epochDocument.difficultyScaled))})] (${epochDocument.epochHash.toString('hex')}) -- !!`,
        );

        // Dispatch onEpochFinalized hook - epoch merkle tree is complete
        await this.dispatchEpochFinalized({
            epochNumber,
            startBlock,
            endBlock,
            checksumRoot: epochDocument.epochRoot.toString('hex'),
        });
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

    /**
     * Dispatch onEpochChange hook to plugins via thread messaging
     */
    private async dispatchEpochChange(epochData: {
        epochNumber: bigint;
        startBlock: bigint;
        endBlock: bigint;
        checksumRoot?: string;
    }): Promise<void> {
        try {
            const msg: ThreadMessageBase<MessageType> = {
                type: MessageType.PLUGIN_EPOCH_CHANGE,
                data: epochData,
            };
            await this.sendMessageToThread(ThreadTypes.PLUGIN, msg);
        } catch (error) {
            this.error(`Error dispatching onEpochChange to plugin thread: ${error}`);
        }
    }

    /**
     * Dispatch onEpochFinalized hook to plugins via thread messaging
     */
    private async dispatchEpochFinalized(epochData: {
        epochNumber: bigint;
        startBlock: bigint;
        endBlock: bigint;
        checksumRoot?: string;
    }): Promise<void> {
        try {
            const msg: ThreadMessageBase<MessageType> = {
                type: MessageType.PLUGIN_EPOCH_FINALIZED,
                data: epochData,
            };
            await this.sendMessageToThread(ThreadTypes.PLUGIN, msg);
        } catch (error) {
            this.error(`Error dispatching onEpochFinalized to plugin thread: ${error}`);
        }
    }
}
