import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { EpochResult } from '../../../../json-rpc/types/interfaces/results/epochs/EpochResult.js';
import { Route } from '../../../Route.js';
import { IEpochDocument } from '../../../../../db/documents/interfaces/IEpochDocument.js';
import { DataConverter } from '@btc-vision/bsi-db';

export class LatestEpoch extends Route<
    Routes.LATEST_EPOCH,
    JSONRpcMethods.GET_EPOCH_BY_NUMBER,
    EpochResult
> {
    private cachedEpoch: Promise<EpochResult | undefined> | EpochResult | undefined;

    constructor() {
        super(Routes.LATEST_EPOCH, RouteType.GET);
    }

    public async getData(): Promise<EpochResult> {
        const resp = await this.getLatestEpoch();
        if (!resp) throw new Error(`Latest epoch not found.`);

        return resp;
    }

    public async getDataRPC(): Promise<EpochResult> {
        return await this.getData();
    }

    public override onEpochFinalized(_epochNumber: bigint, epochData: IEpochDocument): void {
        this.cachedEpoch = this.convertEpochToAPIResult(epochData);
    }

    protected initialize(): void {}

    /**
     * GET /api/v1/epoch/latest
     * @tag Epoch
     * @summary Get the latest epoch.
     * @description Get the most recent epoch in the OPNet protocol.
     * @response 200 - Return the latest epoch.
     * @response 400 - Something went wrong.
     * @response default - Unexpected error
     * @responseContent {EpochAPIResult} 200.application/json
     */
    protected async onRequest(_req: Request, res: Response, _next?: MiddlewareNext): Promise<void> {
        try {
            const data = await this.getData();

            if (data) {
                res.status(200);
                res.json(data);
            } else {
                res.status(400);
                res.json({ error: 'Could not fetch latest epoch. Is this node synced?' });
            }
        } catch (err) {
            this.handleDefaultError(res, err as Error);
        }
    }

    private async fetchLatestEpoch(): Promise<EpochResult | undefined> {
        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        const epoch = await this.storage.getLatestEpoch();
        if (!epoch) {
            throw new Error('No epochs found');
        }

        return this.convertEpochToAPIResult(epoch);
    }

    private async getLatestEpoch(): Promise<EpochResult | undefined> {
        if (this.cachedEpoch && !(this.cachedEpoch instanceof Promise)) {
            return this.cachedEpoch;
        }

        this.cachedEpoch = this.fetchLatestEpoch();
        return await this.cachedEpoch;
    }

    private convertEpochToAPIResult(epoch: IEpochDocument): EpochResult {
        return {
            epochNumber: DataConverter.fromDecimal128(epoch.epochNumber).toString(),
            epochHash: '0x' + epoch.epochHash.toString('hex'),
            epochRoot: '0x' + epoch.epochRoot.toString('hex'),
            startBlock: DataConverter.fromDecimal128(epoch.startBlock).toString(),
            endBlock: DataConverter.fromDecimal128(epoch.endBlock).toString(),
            difficultyScaled: epoch.difficultyScaled,
            minDifficulty: epoch.minDifficulty,
            targetHash: '0x' + epoch.targetHash.toString('hex'),
            proposer: {
                publicKey: '0x' + epoch.proposer.publicKey.toString('hex'),
                salt: '0x' + epoch.proposer.salt.toString('hex'),
                graffiti: epoch.proposer.graffiti
                    ? '0x' + epoch.proposer.graffiti.toString('hex')
                    : '',
                solution: '0x' + epoch.proposer.solution.toString('hex'),
            },
            proofs: epoch.proofs.map((proof) => '0x' + proof.toString('hex')),
        };
    }
}
