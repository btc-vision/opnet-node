import { Logger } from '@btc-vision/bsi-common';
import { Binary } from 'mongodb';
import crypto from 'crypto';
import {
    ITargetEpochDocument,
    PendingTargetEpoch,
} from '../../db/documents/interfaces/ITargetEpochDocument.js';
import { DataConverter } from '@btc-vision/bsi-db';
import { VMStorage } from '../../vm/storage/VMStorage.js';
import { Address } from '@btc-vision/transaction';
import { OPNetConsensus } from '../configurations/OPNetConsensus.js';
import { SHA1 } from '../../utils/SHA1.js';
import { stringToBuffer } from '../../utils/StringToBuffer.js';

export interface EpochValidationParams {
    readonly epochNumber: bigint;
    readonly targetHash: Buffer;
    readonly salt: Buffer;
    readonly publicKey: Address;
    readonly graffiti?: Buffer;
    //readonly blockHeight?: bigint;
}

export interface EpochValidationResult {
    readonly valid: boolean;
    readonly matchingBits: number;
    readonly hash: Buffer;
    readonly targetPattern: Buffer;
    readonly preimage: Buffer;
    readonly message?: string;
}

interface ParamsToConvert {
    epochNumber: string;
    targetHash: string;
    salt: string;
    publicKey: string;
    graffiti?: string;
    //blockHeight?: string;
}

export class EpochValidator extends Logger {
    public readonly logColor: string = '#9370db';

    constructor(private readonly storage: VMStorage) {
        super();
    }

    /**
     * Utility method to convert hex string parameters to validation params
     */
    public static base64ToValidationParams(params: ParamsToConvert): EpochValidationParams {
        return {
            epochNumber: BigInt(params.epochNumber),
            targetHash: Buffer.from(params.targetHash, 'base64'),
            salt: Buffer.from(params.salt, 'base64'),
            publicKey: new Address(Buffer.from(params.publicKey, 'base64')),
            graffiti: Buffer.from(params.graffiti || '', 'base64'),
            //blockHeight: params.blockHeight ? BigInt(params.blockHeight) : undefined,
        };
    }

    public static hexToValidationParams(params: ParamsToConvert): EpochValidationParams {
        return {
            epochNumber: BigInt(params.epochNumber),
            targetHash: stringToBuffer(params.targetHash),
            salt: stringToBuffer(params.salt),
            publicKey: Address.fromString(params.publicKey),
            graffiti: params.graffiti ? stringToBuffer(params.graffiti) : undefined,
            //blockHeight: params.blockHeight ? BigInt(params.blockHeight) : undefined,
        };
    }

    /**
     * Calculate mining preimage using XOR operations
     */
    public static calculatePreimage(
        checksumRoot: Buffer,
        publicKey: Address,
        salt: Buffer,
    ): Buffer {
        // Ensure all buffers are exactly 32 bytes
        const target32 = Buffer.alloc(32);
        const pubKey32 = Buffer.alloc(32);
        const salt32 = Buffer.alloc(32);

        // Copy data into 32-byte buffers
        checksumRoot.copy(target32, 0, 0, Math.min(32, checksumRoot.length));
        publicKey.toBuffer().copy(pubKey32, 0, 0, Math.min(32, publicKey.length));
        salt.copy(salt32, 0, 0, Math.min(32, salt.length));

        // Perform triple XOR operation
        const preimage = Buffer.alloc(32);
        for (let i = 0; i < 32; i++) {
            preimage[i] = target32[i] ^ pubKey32[i] ^ salt32[i];
        }

        return preimage;
    }

    /**
     * Validate an epoch solution submission
     */
    public async validateEpochSolution(
        params: EpochValidationParams,
        currentHeight: bigint,
        minDifficulty: number = 20,
    ): Promise<EpochValidationResult> {
        try {
            // Validate epoch 0 cannot be mined
            if (params.epochNumber === 0n) {
                return {
                    valid: false,
                    matchingBits: 0,
                    hash: Buffer.alloc(0),
                    targetPattern: Buffer.alloc(0),
                    preimage: Buffer.alloc(0),
                    message: 'Epoch 0 cannot be mined',
                };
            }

            // If blockHeight is provided, validate submission timing
            if (currentHeight !== undefined) {
                const blockEpochInterval = BigInt(OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH);
                const currentEpoch = currentHeight / blockEpochInterval;

                // Can only submit for the next epoch to be finalized
                const nextEpochToFinalize = currentEpoch + 1n;

                if (params.epochNumber !== nextEpochToFinalize) {
                    return {
                        valid: false,
                        matchingBits: 0,
                        hash: Buffer.alloc(0),
                        targetPattern: Buffer.alloc(0),
                        preimage: Buffer.alloc(0),
                        message: `Cannot submit for epoch ${params.epochNumber} at block ${currentHeight}. Can only submit for epoch ${nextEpochToFinalize}`,
                    };
                }
            }

            // Get the epoch data from storage
            const epoch = await this.getEpochData(params.epochNumber);

            console.log('Validating epoch solution:', {
                epochNumber: params.epochNumber,
                targetBlock:
                    (params.epochNumber - 1n) *
                    BigInt(OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH),
                targetHash: epoch.targetHash.toString('hex'),
                providedTargetHash: params.targetHash.toString('hex'),
            });

            if (!epoch) {
                return {
                    valid: false,
                    matchingBits: 0,
                    hash: Buffer.alloc(0),
                    targetPattern: Buffer.alloc(0),
                    preimage: Buffer.alloc(0),
                    message: 'Epoch not found',
                };
            }

            // Verify the target hash matches the epoch
            if (!this.verifyTargetHash(epoch, params.targetHash)) {
                return {
                    valid: false,
                    matchingBits: 0,
                    hash: Buffer.alloc(0),
                    targetPattern: Buffer.alloc(0),
                    preimage: Buffer.alloc(0),
                    message: `Target hash does not match epoch. Expected: ${epoch.targetHash.toString('hex')}, got: ${params.targetHash.toString('hex')}`,
                };
            }

            // Calculate the preimage
            const preimage = EpochValidator.calculatePreimage(
                epoch.target,
                params.publicKey,
                params.salt,
            );

            // Calculate SHA-1 of the preimage
            const hash = SHA1.hashBuffer(preimage);

            // Count matching bits against the target hash
            const matchingBits = this.countMatchingBits(hash, epoch.targetHash);

            // Check if meets minimum difficulty
            const valid = matchingBits >= minDifficulty;

            if (valid) {
                this.info(
                    `Valid epoch solution: ${matchingBits} matching bits for epoch ${params.epochNumber}`,
                );
            } else {
                this.warn(
                    `Invalid epoch solution: ${matchingBits} bits < ${minDifficulty} minimum`,
                );
            }

            return {
                valid,
                matchingBits,
                hash,
                targetPattern: epoch.targetHash,
                preimage,
                message: valid
                    ? 'Valid solution'
                    : `Solution does not meet minimum difficulty (${minDifficulty} bits)`,
            };
        } catch (error) {
            this.error(`Epoch validation failed: ${error}`);
            return {
                valid: false,
                matchingBits: 0,
                hash: Buffer.alloc(0),
                targetPattern: Buffer.alloc(0),
                preimage: Buffer.alloc(0),
                message: `Validation error: ${error}`,
            };
        }
    }

    /**
     * Check if a solution already exists for this epoch/salt combination
     */
    public async solutionExists(
        epochNumber: bigint,
        salt: Buffer,
        publicKey: Address | Buffer | Binary,
    ): Promise<boolean> {
        return await this.storage.targetEpochExists(epochNumber, salt, publicKey);
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
            publicKey: new Binary(params.publicKey.toBuffer()),
        };

        await this.storage.saveTargetEpoch(targetEpoch);

        return targetEpoch;
    }

    public countMatchingBits(hash1: Buffer, hash2: Buffer): number {
        let matchingBits = 0;
        const minLength = Math.min(hash1.length, hash2.length);

        for (let i = 0; i < minLength; i++) {
            const byte1 = hash1[i];
            const byte2 = hash2[i];

            if (byte1 === byte2) {
                matchingBits += 8; // Each byte is 8 bits
            } else {
                // Check individual bits in the mismatched byte
                for (let bit = 7; bit >= 0; bit--) {
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
        const data = `${params.epochNumber}:${params.targetHash.toString('hex')}:${params.salt.toString('hex')}:${params.publicKey.toHex()}`;
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    /**
     * Get epoch data from storage
     */
    private async getEpochData(epochNumber: bigint): Promise<PendingTargetEpoch> {
        // Epoch 0 cannot be mined
        if (epochNumber === 0n) {
            throw new Error('Epoch 0 cannot be mined');
        }

        const blockEpochInterval = BigInt(OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH);

        // Get the mining target block (first block of the previous epoch)
        const targetBlockHeight = (epochNumber - 1n) * blockEpochInterval;
        const blockHeader = await this.storage.getBlockHeader(targetBlockHeight);
        if (!blockHeader) {
            throw new Error(
                `Block header not found for mining target height ${targetBlockHeight} (for epoch ${epochNumber})`,
            );
        }

        const target = stringToBuffer(blockHeader.checksumRoot);
        const targetHash = SHA1.hashBuffer(target);

        return {
            target,
            targetHash: targetHash,
            nextEpochNumber: epochNumber,
        };
    }

    /**
     * Verify the target hash matches the epoch
     */
    private verifyTargetHash(epoch: PendingTargetEpoch, targetHash: Buffer): boolean {
        const epochTargetHash =
            epoch.targetHash instanceof Binary ? epoch.targetHash.buffer : epoch.targetHash;

        return Buffer.isBuffer(epochTargetHash) && epochTargetHash.equals(targetHash);
    }
}
