import { Logger } from '@btc-vision/bsi-common';
import { Binary } from 'mongodb';
import crypto from 'crypto';
import { IEpochDocument } from '../../db/documents/interfaces/IEpochDocument.js';
import { ITargetEpochDocument } from '../../db/documents/interfaces/ITargetEpochDocument.js';
import { DataConverter } from '@btc-vision/bsi-db';
import { VMStorage } from '../../vm/storage/VMStorage.js';

export interface EpochValidationParams {
    epochNumber: bigint;
    targetHash: Buffer;
    salt: Buffer;
    publicKey: Buffer;
    graffiti?: string;
    blockHeight?: bigint;
}

export interface EpochValidationResult {
    valid: boolean;
    matchingBits: number;
    hash: string;
    targetPattern: string;
    preimage: Buffer;
    message?: string;
}

export interface EpochSolutionQuality {
    difficulty: number;
    meetsMinimum: boolean;
    qualityScore: number;
}

export class EpochValidator extends Logger {
    public readonly logColor: string = '#9370db'; // Medium purple

    private readonly MIN_DIFFICULTY: number;

    constructor(
        private readonly storage: VMStorage,
        minDifficulty: number = 20,
    ) {
        super();
        this.MIN_DIFFICULTY = minDifficulty;
    }

    /**
     * Utility method to convert hex string parameters to validation params
     */
    public static hexToValidationParams(params: {
        epochNumber: string;
        targetHash: string;
        salt: string;
        publicKey: string;
        graffiti?: string;
        blockHeight?: string;
    }): EpochValidationParams {
        return {
            epochNumber: BigInt(params.epochNumber),
            targetHash: Buffer.from(params.targetHash, 'hex'),
            salt: Buffer.from(params.salt, 'hex'),
            publicKey: Buffer.from(params.publicKey, 'hex'),
            graffiti: params.graffiti,
            blockHeight: params.blockHeight ? BigInt(params.blockHeight) : undefined,
        };
    }

    /**
     * Validate an epoch solution submission
     */
    public async validateEpochSolution(
        params: EpochValidationParams,
    ): Promise<EpochValidationResult> {
        try {
            // Get the epoch data from storage
            const epoch = await this.getEpochData(params.epochNumber, params.blockHeight);

            if (!epoch) {
                return {
                    valid: false,
                    matchingBits: 0,
                    hash: '',
                    targetPattern: '',
                    preimage: Buffer.alloc(0),
                    message: 'Epoch not found',
                };
            }

            // Verify the target hash matches the epoch
            if (!this.verifyTargetHash(epoch, params.targetHash)) {
                return {
                    valid: false,
                    matchingBits: 0,
                    hash: '',
                    targetPattern: '',
                    preimage: Buffer.alloc(0),
                    message: 'Target hash does not match epoch',
                };
            }

            // Calculate the preimage
            const preimage = this.calculatePreimage(
                params.targetHash,
                params.publicKey,
                params.salt,
            );

            // Calculate SHA-1 of the preimage
            const hash = crypto.createHash('sha1').update(preimage).digest('hex');

            // Calculate SHA-1 of the target hash as the pattern
            const targetPattern = crypto.createHash('sha1').update(params.targetHash).digest('hex');

            // Count matching bits
            const matchingBits = this.countMatchingBits(hash, targetPattern);

            // Check if meets minimum difficulty
            const valid = matchingBits >= this.MIN_DIFFICULTY;

            if (valid) {
                this.info(
                    `Valid epoch solution: ${matchingBits} matching bits for epoch ${params.epochNumber}`,
                );
            } else {
                this.warn(
                    `Invalid epoch solution: ${matchingBits} bits < ${this.MIN_DIFFICULTY} minimum`,
                );
            }

            return {
                valid,
                matchingBits,
                hash,
                targetPattern,
                preimage,
                message: valid
                    ? 'Valid solution'
                    : `Solution does not meet minimum difficulty (${this.MIN_DIFFICULTY} bits)`,
            };
        } catch (error) {
            this.error(`Epoch validation failed: ${error}`);
            return {
                valid: false,
                matchingBits: 0,
                hash: '',
                targetPattern: '',
                preimage: Buffer.alloc(0),
                message: `Validation error: ${error}`,
            };
        }
    }

    /**
     * Check if a solution already exists for this epoch/salt combination
     */
    public async solutionExists(epochNumber: bigint, salt: Buffer): Promise<boolean> {
        return await this.storage.targetEpochExists(epochNumber, salt);
    }

    /**
     * Get the best solution for an epoch
     */
    public async getBestSolution(epochNumber: bigint): Promise<ITargetEpochDocument | null> {
        return await this.storage.getBestTargetEpoch(epochNumber);
    }

    /**
     * Save a validated epoch solution
     */
    public async saveEpochSolution(
        params: EpochValidationParams,
        validationResult: EpochValidationResult,
    ): Promise<ITargetEpochDocument> {
        const targetEpoch: ITargetEpochDocument = {
            epochNumber: DataConverter.toDecimal128(params.epochNumber),
            salt: new Binary(params.salt),
            difficulty: validationResult.matchingBits,
        };

        await this.storage.saveTargetEpoch(targetEpoch);

        return targetEpoch;
    }

    /**
     * Evaluate the quality of an epoch solution
     */
    public evaluateSolutionQuality(matchingBits: number): EpochSolutionQuality {
        const meetsMinimum = matchingBits >= this.MIN_DIFFICULTY;

        // Calculate quality score (0-100)
        const maxExpectedBits = 80;
        const range = maxExpectedBits - this.MIN_DIFFICULTY;
        const normalized = Math.min((matchingBits - this.MIN_DIFFICULTY) / range, 1);
        const qualityScore = Math.round(normalized * 100);

        return {
            difficulty: matchingBits,
            meetsMinimum,
            qualityScore,
        };
    }

    /**
     * Calculate mining preimage using XOR operations
     */
    public calculatePreimage(targetHash: Buffer, publicKey: Buffer, salt: Buffer): Buffer {
        // Ensure all buffers are exactly 32 bytes
        const target32 = Buffer.alloc(32);
        const pubKey32 = Buffer.alloc(32);
        const salt32 = Buffer.alloc(32);

        // Copy data into 32-byte buffers
        targetHash.copy(target32, 0, 0, Math.min(32, targetHash.length));
        publicKey.copy(pubKey32, 0, 0, Math.min(32, publicKey.length));
        salt.copy(salt32, 0, 0, Math.min(32, salt.length));

        // Perform triple XOR operation
        const preimage = Buffer.alloc(32);
        for (let i = 0; i < 32; i++) {
            preimage[i] = target32[i] ^ pubKey32[i] ^ salt32[i];
        }

        return preimage;
    }

    /**
     * Count matching leading bits between two hex strings
     */
    public countMatchingBits(hash1: string, hash2: string): number {
        let matchingBits = 0;
        const minLength = Math.min(hash1.length, hash2.length);

        for (let i = 0; i < minLength; i++) {
            const byte1 = parseInt(hash1[i], 16);
            const byte2 = parseInt(hash2[i], 16);

            if (byte1 === byte2) {
                matchingBits += 4; // Each hex digit is 4 bits
            } else {
                // Check individual bits in the mismatched hex digit
                for (let bit = 3; bit >= 0; bit--) {
                    if (((byte1 >> bit) & 1) === ((byte2 >> bit) & 1)) {
                        matchingBits++;
                    } else {
                        // Stop at first non-matching bit
                        return matchingBits;
                    }
                }
            }
        }

        return matchingBits;
    }

    /**
     * Calculate submission hash for unique identification
     */
    public calculateSubmissionHash(params: EpochValidationParams): string {
        const data = `${params.epochNumber}:${params.targetHash.toString('hex')}:${params.salt.toString('hex')}:${params.publicKey.toString('hex')}`;
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    /**
     * Get epoch data from storage
     */
    private async getEpochData(
        epochNumber: bigint,
        blockHeight?: bigint,
    ): Promise<IEpochDocument | undefined> {
        // If block height is provided, get the next epoch for that block
        if (blockHeight !== undefined) {
            const nextEpoch = await this.storage.getNextEpoch(blockHeight);

            // Verify this is the correct epoch number
            if (nextEpoch && BigInt(nextEpoch.epochNumber.toString()) === epochNumber) {
                return nextEpoch;
            }

            this.warn(
                `Next epoch at block ${blockHeight} does not match requested epoch ${epochNumber}`,
            );
        }

        // Otherwise, get epoch by number
        return await this.storage.getEpochByNumber(epochNumber);
    }

    /**
     * Verify the target hash matches the epoch
     */
    private verifyTargetHash(epoch: IEpochDocument, targetHash: Buffer): boolean {
        const epochTargetHash =
            epoch.targetHash instanceof Binary ? epoch.targetHash.buffer : epoch.targetHash;

        return Buffer.isBuffer(epochTargetHash) && epochTargetHash.equals(targetHash);
    }
}
