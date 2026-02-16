import { Routes, RouteType } from '../../../../enums/Routes.js';
import { Route } from '../../../Route.js';
import {
    ChallengeSubmission,
    PreimageResult,
} from '../../../../json-rpc/types/interfaces/results/transactions/PreimageResult.js';
import { BlockHeaderAPIBlockDocument } from '../../../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { MiddlewareNext } from '@btc-vision/hyper-express';
import { DataConverter } from '@btc-vision/bsi-common';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { Request } from '@btc-vision/hyper-express/types/components/http/Request.js';
import { Response } from '@btc-vision/hyper-express/types/components/http/Response.js';
import { OPNetConsensus } from '../../../../../poc/configurations/OPNetConsensus.js';
import { toHex } from '@btc-vision/bitcoin';

export class GetPreimage extends Route<
    Routes.TRANSACTION_PREIMAGE,
    JSONRpcMethods.TRANSACTION_PREIMAGE,
    PreimageResult
> {
    private cachedData: Promise<PreimageResult | undefined> | PreimageResult | undefined;
    private lastBlockHeight: bigint | undefined;
    private cacheTimestamp: number | undefined;

    private readonly CACHE_EXPIRY_MS = 10_000;

    constructor() {
        super(Routes.TRANSACTION_PREIMAGE, RouteType.GET);
    }

    public async getData(): Promise<PreimageResult> {
        const resp = await this.getCachedData();
        if (!resp) throw new Error(`No preimage data found.`);

        return resp;
    }

    public async getDataRPC(): Promise<PreimageResult> {
        return await this.getData();
    }

    public onBlockChange(blockNumber: bigint, _blockHeader: BlockHeaderAPIBlockDocument): void {
        if (this.lastBlockHeight !== blockNumber) {
            this.lastBlockHeight = blockNumber;
            this.invalidateCache();
        }
    }

    protected initialize(): void {}

    /**
     * GET /api/v1/transaction/preimage
     * @tag Block
     * @summary Get the latest preimage and epoch winner to use inside an OPNet transaction
     * @description Get the latest preimage along with the current epoch winner and verification data
     * @response 200 - The preimage and epoch winner data
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {PreimageResult} 200.application/json
     */
    protected async onRequest(_req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            const data = await this.getData();

            if (data) {
                this.safeJson(res, 200, data);
            } else {
                this.safeJson(res, 400, { error: 'Could not fetch preimage data. Is this node synced?' });
            }
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }

    private invalidateCache(): void {
        this.cachedData = undefined;
        this.cacheTimestamp = undefined;
    }

    private isCacheExpired(): boolean {
        if (!this.cacheTimestamp) {
            return true;
        }

        const now = Date.now();
        return now - this.cacheTimestamp > this.CACHE_EXPIRY_MS;
    }

    private async getCachedData(): Promise<PreimageResult | undefined> {
        if (this.cachedData && !this.isCacheExpired()) {
            return this.cachedData;
        }

        this.cachedData = this.getPreimageData();

        return await this.cachedData;
    }

    private uint8ArrayToHex(data: Uint8Array, prefix: boolean = true): string {
        const hex = toHex(data);
        return prefix ? '0x' + hex : hex;
    }

    private async getPreimageData(): Promise<PreimageResult | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        // Get latest block
        const block = await this.storage.getLatestBlock();
        if (!block) {
            throw new Error('Block header not found');
        }

        const currentBlockHeight = BigInt(block.height) + 1n;
        const currentEpoch = currentBlockHeight / OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH;

        // Apply 2-epoch delay
        const targetEpochNumber = currentEpoch - 2n;

        // Don't return data if we don't have enough epochs yet
        if (targetEpochNumber < 0n) {
            return undefined;
        }

        // Get the epoch from 2 epochs ago
        const targetEpoch = await this.storage.getEpochByNumber(targetEpochNumber);
        if (!targetEpoch) {
            throw new Error(`No finalized epoch found for epoch ${targetEpochNumber}`);
        }

        // Convert binary data to hex strings
        const epochNumber = DataConverter.fromDecimal128(targetEpoch.epochNumber);
        const mldsaPublicKey = this.uint8ArrayToHex(targetEpoch.proposer.mldsaPublicKey.buffer);
        const legacyPublicKey = this.uint8ArrayToHex(targetEpoch.proposer.legacyPublicKey.buffer);
        const solution = this.uint8ArrayToHex(targetEpoch.proposer.solution.buffer);
        const salt = this.uint8ArrayToHex(targetEpoch.proposer.salt.buffer);
        const graffiti = targetEpoch.proposer.graffiti
            ? this.uint8ArrayToHex(targetEpoch.proposer.graffiti.buffer)
            : '0x' + '00'.repeat(16);

        const difficulty = parseInt(targetEpoch.difficultyScaled, 10);

        // Verification data
        const epochHash = this.uint8ArrayToHex(targetEpoch.epochHash.buffer);
        const epochRoot = this.uint8ArrayToHex(targetEpoch.epochRoot.buffer);
        const targetHash = this.uint8ArrayToHex(targetEpoch.targetHash.buffer);
        const startBlock = DataConverter.fromDecimal128(targetEpoch.startBlock).toString();
        const endBlock = DataConverter.fromDecimal128(targetEpoch.endBlock).toString();

        // Get the target checksum
        const targetBlockHeight =
            epochNumber * OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH - 1n;

        const targetBlockHeader = await this.storage.getBlockHeader(targetBlockHeight);
        const targetChecksum = targetBlockHeader
            ? targetBlockHeader.checksumRoot
            : '0x' + '00'.repeat(32);

        // Convert proofs to hex strings
        const proofs = targetEpoch.proofs.map((proof) => this.uint8ArrayToHex(proof.buffer));
        const submission = await this.storage.getBestTargetEpoch(currentEpoch);
        const submissionData: ChallengeSubmission | undefined = submission
            ? {
                  mldsaPublicKey: this.uint8ArrayToHex(submission.mldsaPublicKey.buffer),
                  legacyPublicKey: this.uint8ArrayToHex(submission.legacyPublicKey.buffer),
                  solution: this.uint8ArrayToHex(submission.salt.buffer),
                  graffiti: submission.graffiti
                      ? this.uint8ArrayToHex(submission.graffiti.buffer)
                      : '0x' + '00'.repeat(16),
                  signature: this.uint8ArrayToHex(submission.signature.buffer),
              }
            : undefined;

        this.cacheTimestamp = Date.now();

        return {
            epochNumber: epochNumber.toString(),
            mldsaPublicKey,
            legacyPublicKey,
            solution,
            salt,
            graffiti,
            difficulty,
            verification: {
                epochHash,
                epochRoot,
                targetHash,
                targetChecksum,
                startBlock,
                endBlock,
                proofs,
            },
            submission: submissionData,
        };
    }
}
