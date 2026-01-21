import {
    BaseRepository,
    DataConverter,
    PagingQueryInfo,
    PagingQueryResult,
} from '@btc-vision/bsi-common';
import { Binary, BulkWriteOptions, BulkWriteResult, Collection, Db, Filter } from 'mongodb';
import { OPNetBlockWitness } from '../../poc/networking/protobuf/packets/blockchain/common/BlockHeaderWitness.js';
import {
    IBlockWitnessDocument,
    IParsedBlockWitnessDocument,
} from '../models/IBlockWitnessDocument.js';
import { AttestationProof } from '../../blockchain-indexer/processor/block/merkle/EpochMerkleTree.js';

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

    public async updateWitnessProofs(attestationProofs: AttestationProof[]): Promise<void> {
        const bulk = this.getCollection().initializeUnorderedBulkOp();

        for (const proof of attestationProofs) {
            const criteria: Partial<IBlockWitnessDocument> = {
                blockNumber: DataConverter.toDecimal128(proof.attestation.blockNumber),
                publicKey: new Binary(proof.attestation.publicKey),
                signature: new Binary(proof.attestation.signature),
            };

            const update: Partial<IBlockWitnessDocument> = {
                proofs: proof.proofs.map((p) => {
                    return new Binary(p);
                }),
            };

            bulk.find(criteria).updateOne({ $set: update });
        }

        const options: BulkWriteOptions = this.getOptions();
        const response: BulkWriteResult = await bulk.execute(options);

        if (response.modifiedCount !== attestationProofs.length) {
            throw new Error(
                `[DATABASE ERROR] Expected to update ${attestationProofs.length} documents, but only updated ${response.modifiedCount}.`,
            );
        }

        if (response.hasWriteErrors() || !response.isOk()) {
            this.error(`[DATABASE ERROR] Bulk write operation failed.`);

            throw new Error(`[DATABASE ERROR.] Bulk write operation failed.`);
        }
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
            const queryInfo: PagingQueryInfo = new PagingQueryInfo(limit, page ?? 1);

            result = await this.queryManyAndSortPaged(criteria, {}, queryInfo);
        } else {
            result = await this.queryMany(criteria, undefined, {});
        }

        if (!result) {
            return [];
        }

        const witnesses = Array.isArray(result) ? result : result.results;
        return this.parseBlockWitnesses(witnesses);
    }

    public async getWitnessesForEpoch(
        startBlock: bigint,
        endBlock: bigint,
        limitPerBlock: number,
    ): Promise<IParsedBlockWitnessDocument[]> {
        const results: Promise<IParsedBlockWitnessDocument[]>[] = [];
        for (let height = startBlock; height <= endBlock; height++) {
            results.push(this.getWitnesses(height, false, limitPerBlock));
        }

        const allWitnesses = await Promise.safeAll(results);
        const flat = allWitnesses.flat();

        // sort by block number
        return flat.sort((a, b) => {
            if (a.blockNumber < b.blockNumber) {
                return -1;
            } else if (a.blockNumber > b.blockNumber) {
                return 1;
            } else {
                return 0;
            }
        });
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
            const pubKey: Binary | undefined = witness.publicKey
                ? new Binary(witness.publicKey)
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

            const update: IBlockWitnessDocument = {
                blockNumber: blockNumber,
                signature: signature,
                identity: witness.identity,
                timestamp: new Date(Number(witness.timestamp)),
                publicKey: pubKey,
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
                publicKey: witness.publicKey,
                signature: witness.signature,
                trusted: witness.trusted,
                timestamp: witness.timestamp,
                proofs: witness.proofs,
            });
        }

        return parsedWitnesses;
    }
}
