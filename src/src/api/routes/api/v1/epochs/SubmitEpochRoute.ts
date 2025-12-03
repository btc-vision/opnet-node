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
import {
    BinaryWriter,
    MessageSigner,
    MLDSASecurityLevel,
    QuantumBIP32Factory,
} from '@btc-vision/transaction';
import { isEmptyBuffer } from '../../../../../utils/BufferUtils.js';

export class SubmitEpochRoute extends Route<
    Routes.SUBMIT_EPOCH,
    JSONRpcMethods.SUBMIT_EPOCH,
    SubmittedEpochResult
> {
    private pendingBlockHeight: bigint | undefined;

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
        this.pendingBlockHeight = blockHeight;
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

        this.pendingBlockHeight = BigInt(currentBlock.height);
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
     * Validate that hex strings will produce buffers of the correct byte length
     * This validation happens before converting to buffers to provide clear error messages
     */
    private validateHexStringLengths(params: SubmitEpochParamsAsObject): void {
        // Public key validation: must be 33 bytes (66 hex characters)
        if (!params.mldsaPublicKey || typeof params.mldsaPublicKey !== 'string') {
            throw new Error('Public key must be a hex string');
        }

        // Remove '0x' prefix if present for all validations
        const publicKeyHex = params.mldsaPublicKey.startsWith('0x')
            ? params.mldsaPublicKey.slice(2)
            : params.mldsaPublicKey;

        if (publicKeyHex.length !== 64) {
            throw new Error(
                `Public key must be 32 bytes (64 hex characters). Received ${publicKeyHex.length} characters`,
            );
        }

        // Salt validation: must be 32 bytes (64 hex characters)
        if (!params.salt || typeof params.salt !== 'string') {
            throw new Error('Salt must be a hex string');
        }

        const saltHex = params.salt.startsWith('0x') ? params.salt.slice(2) : params.salt;

        if (saltHex.length !== 64) {
            throw new Error(
                `Salt must be 32 bytes (64 hex characters). Received ${saltHex.length} characters`,
            );
        }

        // Target hash validation: must be 20 bytes (40 hex characters)
        if (!params.targetHash || typeof params.targetHash !== 'string') {
            throw new Error('Target hash must be a hex string');
        }

        const targetHashHex = params.targetHash.startsWith('0x')
            ? params.targetHash.slice(2)
            : params.targetHash;

        if (targetHashHex.length !== 64) {
            throw new Error(
                `Target hash must be 32 bytes (64 hex characters). Received ${targetHashHex.length} characters`,
            );
        }

        // Validate that all strings contain only valid hex characters
        const hexRegex = /^[0-9a-fA-F]+$/;

        if (!hexRegex.test(publicKeyHex)) {
            throw new Error('Public key contains invalid hex characters');
        }

        if (!hexRegex.test(saltHex)) {
            throw new Error('Salt contains invalid hex characters');
        }

        if (!hexRegex.test(targetHashHex)) {
            throw new Error('Target hash contains invalid hex characters');
        }

        const signature = params.signature;
        if (!signature || typeof signature !== 'string') {
            throw new Error('Signature must be a hex string');
        }

        const signatureHex = signature.startsWith('0x') ? signature.slice(2) : signature;
        if (signatureHex.length !== 128) {
            throw new Error(
                `Signature must be 64 bytes (128 hex characters). Received ${signatureHex.length} characters`,
            );
        }

        if (!hexRegex.test(signatureHex)) {
            throw new Error('Signature contains invalid hex characters');
        }

        // Graffiti validation if present
        if (params.graffiti) {
            if (typeof params.graffiti !== 'string') {
                throw new Error('Graffiti must be a string');
            }

            const graffitiHex = params.graffiti.startsWith('0x')
                ? params.graffiti.slice(2)
                : params.graffiti;

            // Check if graffiti length exceeds maximum allowed bytes
            // Each hex pair represents one byte, so divide by 2
            const graffitiByteLength = graffitiHex.length / 2;

            if (graffitiByteLength > OPNetConsensus.consensus.EPOCH.GRAFFITI_LENGTH) {
                throw new Error(
                    `Graffiti cannot exceed ${OPNetConsensus.consensus.EPOCH.GRAFFITI_LENGTH} bytes. ` +
                        `Received ${graffitiByteLength} bytes`,
                );
            }

            if (graffitiHex.length > 0 && !hexRegex.test(graffitiHex)) {
                throw new Error('Graffiti contains invalid hex characters');
            }
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

        if (!this.pendingBlockHeight) {
            // 0 will also throw, this is ok.
            throw new Error('Current block height not set. Ensure blockchain is initialized.');
        }

        // Validate parameters structure and presence
        const validatedParams = this.validateSubmissionParams(params);

        // Validate hex string lengths before conversion
        this.validateHexStringLengths(validatedParams);

        // Convert to validation params with block height
        const validationParams = EpochValidator.hexToValidationParams({
            epochNumber: validatedParams.epochNumber,
            targetHash: validatedParams.targetHash,
            salt: validatedParams.salt,
            mldsaPublicKey: validatedParams.mldsaPublicKey,
            graffiti: validatedParams.graffiti,
            signature: validatedParams.signature,
        });

        if (isEmptyBuffer(validationParams.salt)) {
            throw new Error('Salt cannot be empty');
        }

        if (isEmptyBuffer(validationParams.mldsaPublicKey)) {
            throw new Error('MLDSA public key cannot be empty');
        }

        if (isEmptyBuffer(validationParams.targetHash)) {
            throw new Error('Target hash cannot be empty');
        }

        if (isEmptyBuffer(validationParams.signature)) {
            throw new Error('Signature cannot be empty');
        }

        // Check if this epoch/salt combination already exists
        const exists = await this.epochValidator.solutionExists(
            validationParams.epochNumber,
            validationParams.salt,
            validationParams.mldsaPublicKey,
        );

        if (exists) {
            throw new Error('Epoch submission with this salt already exists');
        }

        // Validate the solution (this will now check timing)
        const validationResult = await this.epochValidator.validateEpochSolution(
            validationParams,
            this.pendingBlockHeight,
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

        const legacyPublicKey = await this.validateSignature(validationParams);

        // Save the validated solution
        await this.epochValidator.saveEpochSolution(
            validationParams,
            validationResult,
            legacyPublicKey,
        );

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

    private async validateSignature(data: EpochValidationParams): Promise<Buffer> {
        if (!this.storage) {
            throw new Error('Storage not initialized for signature validation');
        }

        if (!this.pendingBlockHeight) {
            throw new Error('Current block height not set. Ensure blockchain is initialized.');
        }

        const mldsaPublicKeyData = await this.storage.getMLDSAPublicKeyFromHash(
            data.mldsaPublicKey,
            this.pendingBlockHeight,
        );

        if (!mldsaPublicKeyData) {
            throw new Error(
                'Legacy public key not found for the provided MLDSA public key hash. This address is not linked to a ECDSA public key.',
            );
        }

        const signatureDataWriter = new BinaryWriter(64 + 8);
        signatureDataWriter.writeBytes(data.mldsaPublicKey);
        signatureDataWriter.writeU64(data.epochNumber);
        signatureDataWriter.writeBytes(data.salt);

        if (data.graffiti) {
            signatureDataWriter.writeBytes(data.graffiti);
        }

        const signatureData = signatureDataWriter.getBuffer();

        let isValid: boolean;
        if (OPNetConsensus.allowUnsafeSignatures) {
            isValid = MessageSigner.verifySignature(
                mldsaPublicKeyData.legacyPublicKey,
                signatureData,
                data.signature,
            );
        } else {
            // If we are enforcing safe signatures, verify using MLDSA.
            if (!mldsaPublicKeyData.publicKey) {
                throw new Error(
                    `MLDSA public key not exposed. You must make an on-chain transaction that expose your MLDSA public key before submitting epochs.`,
                );
            }

            const keyPair = QuantumBIP32Factory.fromPublicKey(
                mldsaPublicKeyData.publicKey,
                Buffer.alloc(32),
                this.network,
                MLDSASecurityLevel.LEVEL2,
            );

            isValid = MessageSigner.verifyMLDSASignature(keyPair, signatureData, data.signature);
        }

        if (!isValid) {
            throw new Error('Invalid signature for epoch submission');
        }

        return mldsaPublicKeyData.legacyPublicKey;
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
     * Validate the epoch submission parameters for presence and basic structure
     */
    private validateSubmissionParams(params: SubmitEpochParamsAsObject): SubmitEpochParamsAsObject {
        if (!params.epochNumber) {
            throw new Error('Epoch number is required');
        }

        if (!params.mldsaPublicKey) {
            throw new Error('MLDSA public key is required');
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
        // Handle validation errors
        if (
            error.message.includes('bytes') ||
            error.message.includes('hex') ||
            error.message.includes('must be')
        ) {
            res.status(400);
            res.json({
                error: error.message,
                code: 'INVALID_FORMAT',
            });
        } else if (error.message.includes('already exists')) {
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
