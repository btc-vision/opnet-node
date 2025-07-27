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
import { EpochValidationParams, EpochValidator } from '../../../../../poa/epoch/EpochValidator.js';
import { BlockHeaderAPIBlockDocument } from '../../../../../db/interfaces/IBlockHeaderBlockDocument.js';

export class SubmitEpochRoute extends Route<
    Routes.SUBMIT_EPOCH,
    JSONRpcMethods.SUBMIT_EPOCH,
    SubmittedEpochResult
> {
    private currentBlockHeight: bigint | undefined;

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

    public onBlockChange(blockHeight: bigint, _header: BlockHeaderAPIBlockDocument): void {
        this.currentBlockHeight = blockHeight - 1n;
    }

    protected async initialize(): Promise<void> {
        if (!this.storage) {
            throw new Error('Storage not initialized for SubmitEpoch route');
        }

        // Initialize epoch validator with configured minimum difficulty
        this._epochValidator = new EpochValidator(this.storage);

        const currentBlock = await this.storage.getLatestBlock();
        if (!currentBlock) {
            throw new Error('No blocks found in storage to determine current height');
        }

        this.currentBlockHeight = BigInt(currentBlock.height) - 1n;
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

    private validateBuffers(params: EpochValidationParams): void {
        // Ensure all buffers are valid hex strings
        if (params.salt.length !== 32) {
            throw new Error('Salt must be a 32-byte hex string');
        }

        if (params.targetHash.length !== 20) {
            throw new Error('Target hash must be a 20-byte hex string');
        }

        if (
            params.graffiti &&
            params.graffiti.length > OPNetConsensus.consensus.EPOCH.GRAFFITI_LENGTH
        ) {
            throw new Error(
                `Graffiti can not be longer than ${OPNetConsensus.consensus.EPOCH.GRAFFITI_LENGTH} bytes.`,
            );
        }
    }

    /**
     * Process the epoch submission
     */
    private async processEpochSubmission(
        params: SubmitEpochParamsAsObject,
    ): Promise<SubmittedEpochResult> {
        if (!this.storage) {
            throw new Error('Storage not initialized for SubmitEpoch route');
        }

        if (!this.currentBlockHeight) {
            // 0 will also throw, this is ok.
            throw new Error('Current block height not set. Ensure blockchain is initialized.');
        }

        // Validate parameters
        const validatedParams = this.validateSubmissionParams(params);

        // Get current block height for timing validation

        // Convert to validation params with block height
        const validationParams = EpochValidator.hexToValidationParams({
            epochNumber: validatedParams.epochNumber,
            targetHash: validatedParams.targetHash,
            salt: validatedParams.salt,
            publicKey: validatedParams.publicKey,
            graffiti: validatedParams.graffiti,
        });

        this.validateBuffers(validationParams);

        // Check if this epoch/salt combination already exists
        const exists = await this.epochValidator.solutionExists(
            validationParams.epochNumber,
            validationParams.salt,
            validationParams.publicKey,
        );

        if (exists) {
            throw new Error('Epoch submission with this salt already exists');
        }

        // Validate the solution (this will now check timing)
        const validationResult = await this.epochValidator.validateEpochSolution(
            validationParams,
            this.currentBlockHeight,
            OPNetConsensus.consensus.EPOCH.MIN_DIFFICULTY,
        );

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

        let message = 'Submission accepted';
        if (bestSubmission) {
            const currentBestSalt = Buffer.from(bestSubmission.salt.buffer);
            const isWinning = bestSubmission && currentBestSalt.equals(validationParams.salt);

            if (isWinning) {
                message = 'Current best submission';
            }
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
        if (!params.epochNumber) {
            throw new Error('Epoch target is required');
        }

        if (!params.publicKey) {
            throw new Error('Public key is required');
        }

        if (!params.targetHash) {
            throw new Error('Target hash is required');
        }

        if (!params.salt) {
            throw new Error('Salt is required');
        }

        return params;
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
