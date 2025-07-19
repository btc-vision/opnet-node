import { Request } from 'hyper-express/types/components/http/Request.js';
import { Response } from 'hyper-express/types/components/http/Response.js';
import { MiddlewareNext } from 'hyper-express/types/components/middleware/MiddlewareNext.js';
import { Routes, RouteType } from '../../../../enums/Routes.js';
import { JSONRpcMethods } from '../../../../json-rpc/types/enums/JSONRpcMethods.js';
import { Route } from '../../../Route.js';
import { SafeBigInt } from '../../../safe/BlockParamsConverter.js';
import { Config } from '../../../../../config/Config.js';
import { AdvancedCaching } from '../../../../../caching/AdvancedCaching.js';
import { IEpochDocument } from '../../../../../db/documents/interfaces/IEpochDocument.js';
import { EpochAPIResult } from '../../../../json-rpc/types/interfaces/results/epochs/EpochResult.js';
import { EpochByNumberParams } from '../../../../json-rpc/types/interfaces/params/epochs/EpochByNumberParams.js';
import { EpochByHashParams } from '../../../../json-rpc/types/interfaces/params/epochs/EpochByHashParams.js';
import { Decimal128 } from 'mongodb';
import { DataConverter } from '@btc-vision/bsi-db';
import {
    EpochSubmissionAPIResult,
    IEpochSubmissionsDocument,
} from '../../../../../db/documents/interfaces/IEpochSubmissionsDocument.js';

export abstract class EpochRoute<T extends Routes> extends Route<
    T,
    JSONRpcMethods.GET_EPOCH_BY_HASH | JSONRpcMethods.GET_EPOCH_BY_NUMBER,
    EpochAPIResult | undefined
> {
    protected cachedEpochs: AdvancedCaching<SafeBigInt | string, Promise<EpochAPIResult>> =
        new AdvancedCaching();

    protected currentEpochData: EpochAPIResult | undefined;

    private pendingRequests: number = 0;

    protected constructor(route: T) {
        super(route, RouteType.GET);
    }

    public abstract getData(
        params: EpochByNumberParams | EpochByHashParams,
    ): Promise<EpochAPIResult | undefined>;

    public abstract getDataRPC(
        params: EpochByNumberParams | EpochByHashParams,
    ): Promise<EpochAPIResult | undefined>;

    public onEpochChange(epochNumber: bigint, epochData: IEpochDocument): void {
        this.currentEpochData = this.convertEpochToAPIResult(epochData);

        // Clear cache for this epoch to ensure fresh data
        this.cachedEpochs.delete(epochNumber.toString());
    }

    protected async getCachedEpochData(
        includeSubmissions: boolean,
        epochNumber?: SafeBigInt,
        epochHash?: string,
    ): Promise<EpochAPIResult> {
        const epochIdentifier =
            typeof epochNumber === 'bigint' || typeof epochNumber === 'number'
                ? epochNumber.toString()
                : epochHash;

        if (epochIdentifier === undefined || epochIdentifier === null || epochIdentifier === '') {
            throw new Error(`No epoch number or hash provided`);
        }

        // Return current epoch data if requesting latest without submissions
        if (epochNumber === -1n && this.currentEpochData && !includeSubmissions) {
            return this.currentEpochData;
        }

        const documentKey = `${epochIdentifier}${includeSubmissions}`;
        const cachedData = await this.getCachedData(documentKey);
        if (cachedData) {
            return cachedData;
        }

        this.setToCache(documentKey, this.getEpochData(includeSubmissions, epochNumber, epochHash));

        const cachedKey = this.getCachedData(documentKey);
        if (!cachedKey) {
            throw new Error('No cached key found');
        }

        return cachedKey;
    }

    protected async getEpochData(
        includeSubmissions: boolean,
        epochNumber?: SafeBigInt,
        epochHash?: string,
    ): Promise<EpochAPIResult> {
        const epochIdentifier =
            typeof epochNumber === 'bigint' || typeof epochNumber === 'number'
                ? epochNumber.toString()
                : epochHash;

        if (epochIdentifier === undefined || epochIdentifier === null || epochIdentifier === '') {
            throw new Error(`No epoch number or hash provided`);
        }

        if (!this.storage) {
            throw new Error('Storage not initialized');
        }

        let epoch: IEpochDocument | undefined;

        if (epochHash) {
            const hashBuffer = Buffer.from(epochHash.replace('0x', ''), 'hex');
            epoch = await this.storage.getEpochByHash(hashBuffer);
        } else if (epochNumber === -1n) {
            epoch = await this.storage.getLatestEpoch();
        } else if (epochNumber !== undefined) {
            epoch = await this.storage.getEpochByNumber(epochNumber);
        }

        if (!epoch) {
            throw new Error(`No epoch found for identifier ${epochIdentifier}`);
        }

        return this.convertEpochToAPIResultWithSubmissions(epoch, includeSubmissions);
    }

    protected async convertEpochToAPIResultWithSubmissions(
        epoch: IEpochDocument,
        includeSubmissions: boolean,
    ): Promise<EpochAPIResult> {
        const apiResult: EpochAPIResult = this.convertEpochToAPIResult(epoch);

        if (includeSubmissions && this.storage) {
            const epochNumber = this.convertDecimal128ToBigInt(epoch.epochNumber);
            const submissions = await this.storage.getSubmissionsByEpochNumber(epochNumber);

            apiResult.submissions = submissions.map(
                (submission: IEpochSubmissionsDocument): EpochSubmissionAPIResult => ({
                    submissionTxId: submission.submissionTxId.toString('hex'),
                    submissionTxHash: submission.submissionTxHash.toString('hex'),
                    submissionHash: submission.submissionHash.toString('hex'),
                    confirmedAt: this.convertDecimal128ToString(submission.confirmedAt),
                    epochProposed: {
                        solution: submission.epochProposed.solution.toString('hex'),
                        publicKey: submission.epochProposed.publicKey.toString('hex'),
                        salt: submission.epochProposed.salt.toString('hex'),
                        graffiti: submission.epochProposed.graffiti?.toString('hex'),
                    },
                }),
            );
        }

        return apiResult;
    }

    protected checkRateLimit(): boolean {
        return this.pendingRequests + 1 <= Config.API.MAXIMUM_PARALLEL_EPOCH_QUERY;
    }

    protected incrementPendingRequests(): void {
        if (!this.checkRateLimit()) {
            throw new Error('Too many epoch pending requests');
        }

        this.pendingRequests++;
    }

    protected decrementPendingRequests(): void {
        this.pendingRequests--;
    }

    protected initialize(): void {}

    protected abstract onRequest(
        _req: Request,
        res: Response,
        _next?: MiddlewareNext,
    ): Promise<void>;

    protected getCachedData(key: string): Promise<EpochAPIResult> | undefined {
        return this.cachedEpochs.get(key);
    }

    protected setToCache(key: SafeBigInt | string, data: Promise<EpochAPIResult>) {
        if (
            this.cachedEpochs.size() >= Config.API.EPOCH_CACHE_SIZE ||
            this.cachedEpochs.size() >= 100
        ) {
            this.purgeCache();
        }

        this.cachedEpochs.set(key, data);
    }

    protected convertEpochToAPIResult(epoch: IEpochDocument): EpochAPIResult {
        return {
            epochNumber: this.convertDecimal128ToString(epoch.epochNumber),
            epochHash: epoch.epochHash.toString('hex'),
            startBlock: this.convertDecimal128ToString(epoch.startBlock),
            endBlock: this.convertDecimal128ToString(epoch.endBlock),
            difficultyScaled: epoch.difficultyScaled,
            minDifficulty: epoch.minDifficulty,
            targetHash: epoch.targetHash.toString('hex'),
            proposer: {
                solution: epoch.proposer.solution.toString('hex'),
                publicKey: epoch.proposer.publicKey.toString('hex'),
                salt: epoch.proposer.salt.toString('hex'),
                graffiti: epoch.proposer.graffiti?.toString('hex'),
            },
        };
    }

    protected convertDecimal128ToString(value: Decimal128): string {
        return this.convertDecimal128ToBigInt(value).toString();
    }

    protected convertDecimal128ToBigInt(value: Decimal128): bigint {
        return DataConverter.fromDecimal128(value);
    }

    protected validateEpochParams(params: EpochByNumberParams | EpochByHashParams): {
        epochNumber?: bigint;
        epochHash?: string;
        includeSubmissions: boolean;
    } {
        // Handle array format
        if (Array.isArray(params)) {
            const includeSubmissions = typeof params[1] === 'boolean' ? params[1] : false;

            // For hash params: [string, boolean?]
            if (typeof params[0] === 'string' && !params[0].match(/^-?\d+$/)) {
                return { epochHash: params[0], includeSubmissions };
            }
            // For number params: [string | bigint | -1, boolean?]
            const value = params[0];
            if (value === -1 || value === '-1') {
                return { epochNumber: -1n, includeSubmissions };
            }
            return {
                epochNumber: typeof value === 'string' ? BigInt(value) : value,
                includeSubmissions,
            };
        }

        // Handle object format
        const includeSubmissions = params.includeSubmissions ?? false;

        if ('hash' in params) {
            if (typeof params.hash !== 'string') {
                throw new Error('Invalid hash parameter: expected a string');
            }

            const cleanHash: string | undefined = params.hash?.replace('0x', '');
            if (cleanHash.length !== 64) {
                throw new Error('Invalid hash length. Expected 64 hex characters for SHA-1 hash');
            }

            return { epochHash: cleanHash, includeSubmissions };
        }

        if ('height' in params) {
            const height = params.height;
            if (height === -1 || height === '-1') {
                return { epochNumber: -1n, includeSubmissions };
            }
            if (typeof height === 'string') {
                return { epochNumber: BigInt(height), includeSubmissions };
            }
            return { epochNumber: height, includeSubmissions };
        }

        throw new Error('Invalid params: missing height or hash');
    }

    private purgeCache(): void {
        // Keep the most recent 50 entries
        const entries = Array.from(this.cachedEpochs.entries());
        const toKeep = entries.slice(-Config.API.EPOCH_CACHE_SIZE);

        this.cachedEpochs.clear();

        toKeep.forEach(([key, value]) => {
            this.cachedEpochs.set(key, value);
        });
    }
}
