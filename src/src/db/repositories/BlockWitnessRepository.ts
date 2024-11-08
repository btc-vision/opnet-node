import { BaseRepository, PagingQueryInfo, PagingQueryResult } from '@btc-vision/bsi-common';

import { DataConverter } from '@btc-vision/bsi-db';
import { Binary, BulkWriteOptions, BulkWriteResult, Collection, Db, Filter } from 'mongodb';
import { OPNetBlockWitness } from '../../poa/networking/protobuf/packets/blockchain/common/BlockHeaderWitness.js';
import {
    IBlockWitnessDocument,
    IParsedBlockWitnessDocument,
} from '../models/IBlockWitnessDocument.js';

export class BlockWitnessRepository extends BaseRepository<IBlockWitnessDocument> {
    public readonly logColor: string = '#afeeee';

    public constructor(db: Db) {
        super(db);
    }

    public async deleteBlockWitnessesFromHeight(height: bigint): Promise<void> {
        const criteria: Partial<Filter<IBlockWitnessDocument>> = {
            blockNumber: {
                $gte: DataConverter.toDecimal128(height),
            },
        };

        await this.delete(criteria);
    }

    public async getWitnesses(
        height: bigint,
        trusted?: boolean,
        limit?: number,
        page?: number,
    ): Promise<IParsedBlockWitnessDocument[]> {
        const criteria: Partial<Filter<IBlockWitnessDocument>> = {
            blockNumber: DataConverter.toDecimal128(height),
        };

        if (trusted !== undefined) {
            criteria.trusted = trusted;
        }

        let result: PagingQueryResult<IBlockWitnessDocument> | IBlockWitnessDocument[];
        if (limit) {
            const queryInfo: PagingQueryInfo = new PagingQueryInfo(limit, page || 0);

            result = await this.queryManyAndSortPaged(criteria, { blockNumber: 1 }, queryInfo);
        } else {
            result = await this.queryMany(criteria, undefined, { blockNumber: 1 });
        }

        if (!result) {
            return [];
        }

        const witnesses = result instanceof Array ? result : result.results;

        return this.parseBlockWitnesses(witnesses);
    }

    public async getBlockWitnesses(
        height: bigint,
        trusted: boolean = false,
        identity?: string[],
    ): Promise<IParsedBlockWitnessDocument[] | undefined> {
        const criteria: Partial<Filter<IBlockWitnessDocument>> = {
            blockNumber: DataConverter.toDecimal128(height),
            trusted: trusted,
        };

        if (identity && identity.length) {
            criteria.identity = { $in: identity };
        }

        const witnesses = await this.queryMany(criteria);
        if (!witnesses) {
            return;
        }

        return this.parseBlockWitnesses(witnesses);
    }

    public async setBlockWitnesses(height: bigint, witnesses: OPNetBlockWitness[]): Promise<void> {
        /** bulk write */

        const bulk = this.getCollection().initializeUnorderedBulkOp();

        for (const witness of witnesses) {
            if (!witness.identity) {
                this.warn(`[BLOCK WITNESS.] Witness identity is missing. Skipping this witness.`);
                continue;
            }

            const signature = new Binary(witness.signature);
            const pubKey: Binary | undefined = witness.opnetPubKey
                ? new Binary(witness.opnetPubKey)
                : undefined;

            const blockNumber = DataConverter.toDecimal128(height);

            const isTrusted = !pubKey;
            if (!signature) {
                continue;
            }

            const criteria: Partial<IBlockWitnessDocument> = {
                blockNumber: blockNumber,
                identity: witness.identity,
            };

            const update: Partial<IBlockWitnessDocument> = {
                blockNumber: blockNumber,
                signature: signature,
                identity: witness.identity,
                opnetPubKey: pubKey,
                trusted: isTrusted,
            };

            bulk.find(criteria).upsert().updateOne({ $set: update });
        }

        const options: BulkWriteOptions = this.getOptions();
        const response: BulkWriteResult = await bulk.execute(options);

        let errored = false;
        if (response.hasWriteErrors()) {
            const errors = response.getWriteErrors();

            for (const error of errors) {
                this.error(`[DATABASE ERROR.] ${error.errmsg}`);
            }

            errored = true;
        } else if (!response.isOk()) {
            errored = true;
        }

        if (errored) {
            this.error(`[DATABASE ERROR.] Bulk write operation failed.`);
            throw new Error(`[DATABASE ERROR.] Bulk write operation failed.`);
        }
    }

    protected override getCollection(): Collection<IBlockWitnessDocument> {
        return this._db.collection('BlockWitnesses');
    }

    private parseBlockWitnesses(witnesses: IBlockWitnessDocument[]): IParsedBlockWitnessDocument[] {
        const parsedWitnesses: IParsedBlockWitnessDocument[] = [];

        for (const witness of witnesses) {
            parsedWitnesses.push({
                blockNumber: DataConverter.fromDecimal128(witness.blockNumber),
                identity: witness.identity,
                opnetPubKey: witness.opnetPubKey,
                signature: witness.signature,
                trusted: witness.trusted,
            });
        }

        return parsedWitnesses;
    }
}
