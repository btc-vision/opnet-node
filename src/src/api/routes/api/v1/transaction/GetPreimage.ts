import { Routes, RouteType } from '../../../../enums/Routes.js';
import { Route } from '../../../Route.js';
import { PreimageResult } from '../../../../json-rpc/types/interfaces/results/transactions/PreimageResult.js';
import { BlockHeaderAPIBlockDocument } from '../../../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { MiddlewareNext } from 'hyper-express';
import { DataConverter } from '@btc-vision/bsi-db';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';

export class GetPreimage extends Route<
    Routes.TRANSACTION_PREIMAGE,
    JSONRpcMethods.TRANSACTION_PREIMAGE,
    PreimageResult
> {
    private cachedData: Promise<PreimageResult | undefined> | PreimageResult | undefined;
    private lastBlockHeight: bigint | undefined;

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
        // Only update cache if we've moved to a new block
        if (this.lastBlockHeight !== blockNumber) {
            this.lastBlockHeight = blockNumber;
            this.cachedData = this.getPreimageData();
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
                res.status(200);
                res.json(data);
            } else {
                res.status(400);
                res.json({ error: 'Could not fetch preimage data. Is this node synced?' });
            }
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }

    private async getCachedData(): Promise<PreimageResult | undefined> {
        if (this.cachedData) {
            return this.cachedData;
        }

        this.cachedData = this.getPreimageData();
        return await this.cachedData;
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

        // Get the latest finalized epoch
        const latestEpoch = await this.storage.getLatestEpoch();
        if (!latestEpoch) {
            throw new Error('No finalized epoch found');
        }

        // Convert binary data to hex strings
        const epochNumber = DataConverter.fromDecimal128(latestEpoch.epochNumber);
        const publicKey = Buffer.from(latestEpoch.proposer.publicKey.buffer).toString('hex');
        const solution = Buffer.from(latestEpoch.proposer.solution.buffer).toString('hex');
        const salt = Buffer.from(latestEpoch.proposer.salt.buffer).toString('hex');
        const graffiti = latestEpoch.proposer.graffiti
            ? Buffer.from(latestEpoch.proposer.graffiti.buffer).toString('hex')
            : '00'.repeat(16); // Default graffiti length

        const difficulty = parseInt(latestEpoch.difficultyScaled);

        // Verification data
        const epochHash = Buffer.from(latestEpoch.epochHash.buffer).toString('hex');
        const epochRoot = Buffer.from(latestEpoch.epochRoot.buffer).toString('hex');
        const targetHash = Buffer.from(latestEpoch.targetHash.buffer).toString('hex');
        const startBlock = DataConverter.fromDecimal128(latestEpoch.startBlock).toString();
        const endBlock = DataConverter.fromDecimal128(latestEpoch.endBlock).toString();

        // Get the target checksum (what was mined)
        const targetBlockHeight = epochNumber * 5n - 1n; // Last block of previous epoch
        const targetBlockHeader = await this.storage.getBlockHeader(targetBlockHeight);
        const targetChecksum = targetBlockHeader
            ? targetBlockHeader.checksumRoot
            : '0x' + '00'.repeat(32);

        // Convert proofs to hex strings
        const proofs = latestEpoch.proofs.map((proof) => Buffer.from(proof.buffer).toString('hex'));

        return {
            epochNumber: epochNumber.toString(),
            publicKey: '0x' + publicKey,
            solution: '0x' + solution,
            salt: '0x' + salt,
            graffiti: '0x' + graffiti,
            difficulty,
            verification: {
                epochHash: '0x' + epochHash,
                epochRoot: '0x' + epochRoot,
                targetHash: '0x' + targetHash,
                targetChecksum,
                startBlock,
                endBlock,
                proofs: proofs.map((p) => '0x' + p),
            },
        };
    }
}
