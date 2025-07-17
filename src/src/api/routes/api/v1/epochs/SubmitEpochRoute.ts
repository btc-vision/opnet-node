import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { Route } from '../../../Route.js';
import {
    SubmitEpochParams,
    SubmitEpochParamsAsObject,
} from '../../../../json-rpc/types/interfaces/params/epochs/SubmitEpochParams.js';
import { OPNetConsensus } from '../../../../../poa/configurations/OPNetConsensus.js';
import {
    SubmissionStatus,
    SubmittedEpochResult,
} from '../../../../json-rpc/types/interfaces/results/epochs/SubmittedEpochResult.js';
import { EpochValidator } from '../../../../../poa/epoch/EpochValidator.js';
import crypto from 'crypto';

export class SubmitEpoch extends Route<
    Routes.SUBMIT_EPOCH,
    JSONRpcMethods.SUBMIT_EPOCH,
    SubmittedEpochResult
> {
    constructor() {
        super(Routes.SUBMIT_EPOCH, RouteType.POST);
    }

    private _epochValidator: EpochValidator | undefined;

    private get epochValidator(): EpochValidator {
        if (!this._epochValidator) {
            throw new Error('EpochValidator not initialized');
        }

        return this._epochValidator;
    }

    public async getData(params: SubmitEpochParams): Promise<SubmittedEpochResult> {
        const normalizedParams = this.normalizeParams(params);
        return this.processEpochSubmission(normalizedParams);
    }

    public async getDataRPC(params: SubmitEpochParams): Promise<SubmittedEpochResult> {
        const normalizedParams = this.normalizeParams(params);
        return this.processEpochSubmission(normalizedParams);
    }

    protected initialize(): void {
        if (!this.storage) {
            throw new Error('Storage not initialized for SubmitEpoch route');
        }

        // Initialize epoch validator with configured minimum difficulty
        this._epochValidator = new EpochValidator(
            this.storage,
            OPNetConsensus.consensus.EPOCH.MIN_DIFFICULTY,
        );
    }

    /**
     * POST /api/v1/epoch/submit
     * @tag Epoch
     * @summary Submit a new epoch solution.
     * @bodyParam {string} epochTarget - The target epoch number.
     * @bodyParam {string} targetHash - The target hash to solve.
     * @bodyParam {string} salt - The salt used in the solution.
     * @bodyParam {string} publicKey - The miner's public key.
     * @bodyParam {string} [graffiti] - Optional graffiti message.
     * @description Submit a SHA-1 collision solution for epoch mining.
     * @response 200 - Epoch submission accepted.
     * @response 400 - Invalid submission.
     * @response 409 - Epoch already solved.
     * @response default - Unexpected error
     * @responseContent {SubmittedEpochResult} 200.application/json
     */
    protected async onRequest(req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            // Validate that this is a POST request with body
            if (!req.body) {
                res.status(400);
                res.json({
                    error: 'Request body required',
                    code: 'MISSING_BODY',
                });
                return;
            }

            const params = req.body as SubmitEpochParams;
            const result = await this.getData(params);

            res.status(200);
            res.json(result);
        } catch (err) {
            this.handleSubmissionError(res, err as Error);
        }
    }

    /**
     * Process the epoch submission
     */
    private async processEpochSubmission(
        params: SubmitEpochParamsAsObject,
    ): Promise<SubmittedEpochResult> {
        // Validate parameters
        const validatedParams = this.validateSubmissionParams(params);

        // Convert to validation params
        const validationParams = EpochValidator.hexToValidationParams({
            epochNumber: validatedParams.epochTarget,
            targetHash: validatedParams.targetHash,
            salt: validatedParams.salt,
            publicKey: validatedParams.publicKey,
            graffiti: validatedParams.graffiti,
        });

        // Check if this epoch/salt combination already exists
        const exists = await this.epochValidator.solutionExists(
            validationParams.epochNumber,
            validationParams.salt,
        );

        if (exists) {
            throw new Error('Epoch submission with this salt already exists');
        }

        // Validate the solution
        const validationResult = await this.epochValidator.validateEpochSolution(validationParams);

        if (!validationResult.valid) {
            return {
                epochNumber: validationParams.epochNumber.toString(),
                submissionHash: this.epochValidator.calculateSubmissionHash(validationParams),
                difficulty: validationResult.matchingBits,
                timestamp: Date.now(),
                status: SubmissionStatus.REJECTED,
                message: validationResult.message || 'Invalid solution',
            };
        }

        // Save the validated solution
        await this.epochValidator.saveEpochSolution(validationParams, validationResult);

        // Get submission hash
        const submissionHash = this.epochValidator.calculateSubmissionHash(validationParams);

        // Check if this is the best submission
        const bestSubmission = await this.epochValidator.getBestSolution(
            validationParams.epochNumber,
        );

        const isWinning =
            bestSubmission &&
            bestSubmission.submissionHash.buffer.equals(Buffer.from(submissionHash, 'hex'));

        let message = 'Submission accepted';
        if (isWinning) {
            message = 'Current best submission';
        }

        return {
            epochNumber: validationParams.epochNumber.toString(),
            submissionHash: submissionHash,
            difficulty: validationResult.matchingBits,
            timestamp: Date.now(),
            status: SubmissionStatus.ACCEPTED,
            message: message,
        };
    }

    /**
     * Normalize parameters from array or object format
     */
    private normalizeParams(params: SubmitEpochParams): SubmitEpochParamsAsObject {
        if (Array.isArray(params)) {
            return params[0];
        }
        return params;
    }

    /**
     * Validate the epoch submission parameters
     */
    private validateSubmissionParams(params: SubmitEpochParamsAsObject): SubmitEpochParamsAsObject {
        // Validate epochTarget
        if (!params.epochTarget || !/^\d+$/.test(params.epochTarget)) {
            throw new Error('Invalid epoch target format');
        }

        // Validate targetHash (SHA-1 is 40 hex chars)
        if (!params.targetHash || !/^[0-9a-fA-F]{40}$/.test(params.targetHash)) {
            throw new Error('Invalid target hash format (must be 40 hex characters)');
        }

        // Validate salt (assume reasonable length)
        if (!params.salt || !/^[0-9a-fA-F]+$/.test(params.salt) || params.salt.length < 16) {
            throw new Error('Invalid salt format (must be at least 8 bytes in hex)');
        }

        // Validate publicKey (assume 33 or 65 bytes for compressed/uncompressed)
        if (!params.publicKey || !/^[0-9a-fA-F]{66,130}$/.test(params.publicKey)) {
            throw new Error('Invalid public key format');
        }

        // Validate graffiti if provided (limit length)
        if (params.graffiti && params.graffiti.length > 80) {
            throw new Error('Graffiti too long (max 80 characters)');
        }

        return params;
    }

    /**
     * Calculate difficulty based on collision quality (matching bits)
     */
    private calculateDifficulty(targetHash: Buffer, publicKey: Buffer, salt: Buffer): number {
        // Calculate the preimage using XOR operation
        const preimage = this.calculatePreimage(targetHash, publicKey, salt);

        // Calculate SHA-1 of the preimage to get the actual hash
        const hash = crypto.createHash('sha1').update(preimage).digest('hex');

        // Calculate SHA-1 of the target hash as the pattern to match against
        const targetPattern = crypto.createHash('sha1').update(targetHash).digest('hex');

        // Count matching bits between hash and target pattern
        const matchingBits = this.countMatchingBits(hash, targetPattern);

        return matchingBits;
    }

    /**
     * Verify the SHA-1 collision solution
     * @param params The submission parameters
     * @returns True if valid collision
     */
    private async verifySolution(params: SubmitEpochParamsAsObject): Promise<boolean> {
        try {
            // Convert hex strings to buffers
            const targetHashBuffer = Buffer.from(params.targetHash, 'hex');
            const saltBuffer = Buffer.from(params.salt, 'hex');
            const publicKeyBuffer = Buffer.from(params.publicKey, 'hex');

            // Calculate the preimage using XOR operation
            const preimage = this.calculatePreimage(targetHashBuffer, publicKeyBuffer, saltBuffer);

            // Calculate SHA-1 of the preimage
            const hash = crypto.createHash('sha1').update(preimage).digest('hex');

            // Calculate SHA-1 of the target hash as the pattern to match
            const targetPattern = crypto.createHash('sha1').update(targetHashBuffer).digest('hex');

            // Count matching bits
            const matchingBits = this.countMatchingBits(hash, targetPattern);

            // Verify the solution meets minimum difficulty
            if (matchingBits < OPNetConsensus.consensus.EPOCH.MIN_DIFFICULTY) {
                this.warn(
                    `Solution rejected: ${matchingBits} bits < ${OPNetConsensus.consensus.EPOCH.MIN_DIFFICULTY} minimum`,
                );
                return false;
            }

            // Log successful verification
            this.info(`Solution verified: ${matchingBits} matching bits`);

            return true;
        } catch (error) {
            this.error(`Solution verification failed: ${error}`);
            return false;
        }
    }

    /**
     * Calculate the preimage by XORing targetHash, publicKey, and salt
     * All buffers must be 32 bytes
     */
    private calculatePreimage(targetHash: Buffer, publicKey: Buffer, salt: Buffer): Buffer {
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
     * Adapted from ShareValidator
     */
    private countMatchingBits(hash1: string, hash2: string): number {
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
     * Handle submission-specific errors
     */
    private handleSubmissionError(res: Response, error: Error): void {
        if (error.message.includes('already exists')) {
            res.status(409);
            res.json({
                error: error.message,
                code: 'DUPLICATE_SUBMISSION',
            });
        } else if (error.message.includes('Invalid')) {
            res.status(400);
            res.json({
                error: error.message,
                code: 'INVALID_PARAMETERS',
            });
        } else {
            this.handleDefaultError(res, error);
        }
    }
}
