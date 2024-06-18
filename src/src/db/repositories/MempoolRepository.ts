import { BaseRepository } from '@btc-vision/bsi-common';
import { Binary, Collection, Db, Filter } from 'mongodb';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';
import { IMempoolTransaction, IMempoolTransactionObj } from '../interfaces/IMempoolTransaction.js';

export class MempoolRepository extends BaseRepository<IMempoolTransaction> {
    public readonly logColor: string = '#afeeee';

    constructor(db: Db) {
        super(db);
    }

    public async getTransactionByIdentifier(
        transactionIdentifier: bigint,
        psbt: boolean,
        id?: string | null,
    ): Promise<IMempoolTransactionObj | undefined> {
        const criteria: Filter<IMempoolTransaction> = {
            identifier: this.bigIntToBinary(transactionIdentifier),
            psbt: psbt,
        };

        if (id) {
            criteria.id = id;
        }

        const result = await this.queryOne(criteria);
        if (!result) {
            return;
        }

        return this.convertToObj(result);
    }

    public async hasTransactionByIdentifier(
        transactionIdentifier: bigint,
        psbt: boolean,
    ): Promise<boolean> {
        const result = await this.getTransactionByIdentifier(transactionIdentifier, psbt);

        return !!result;
    }

    public async storeIfNotExists(transaction: IMempoolTransactionObj): Promise<boolean> {
        const exists = await this.getTransactionByIdentifier(
            transaction.identifier,
            transaction.psbt,
        );

        if (!exists) {
            await this.storeTransaction(transaction);
        }

        return !!exists;
    }

    public async storePsbtIfNotExists(transaction: IMempoolTransactionObj): Promise<boolean> {
        const exists = await this.getTransactionByIdentifier(
            transaction.identifier,
            transaction.psbt,
            transaction.id,
        );

        if (!exists) {
            await this.storeTransaction(transaction);
        }

        return !!exists;
    }

    public async deleteTransactionByIdentifier(
        transactionIdentifier: bigint,
        psbt: boolean,
    ): Promise<boolean> {
        const filter: Filter<IMempoolTransaction> = {
            identifier: this.bigIntToBinary(transactionIdentifier),
            psbt: psbt,
        };

        try {
            await this.delete(filter);
            return true;
        } catch (e) {
            return false;
        }
    }

    public async updateTransactionHash(
        transactionIdentifier: bigint,
        hash: string,
    ): Promise<boolean> {
        const filter: Filter<IMempoolTransaction> = {
            identifier: this.bigIntToBinary(transactionIdentifier),
            psbt: false,
        };

        const update: Filter<IMempoolTransaction> = {
            $set: {
                id: hash,
            },
        };

        try {
            await this.updatePartialWithFilter(filter, update);
            return true;
        } catch (e) {
            return false;
        }
    }

    public async storeTransaction(transaction: IMempoolTransactionObj): Promise<boolean> {
        const data: IMempoolTransaction = this.convertToDb(transaction);
        const filter: Filter<IMempoolTransaction> = {
            identifier: data.identifier,
            psbt: data.psbt,
        };

        try {
            await this.updatePartialWithFilter(filter, {
                $set: data,
            });
            return true;
        } catch (e) {
            return false;
        }
    }

    protected override getCollection(): Collection<IMempoolTransaction> {
        return this._db.collection(OPNetCollections.Mempool);
    }

    private bigintToBuffer(bigInt: bigint): Buffer {
        return Buffer.from(bigInt.toString(16), 'hex');
    }

    private bigIntToBinary(bigInt: bigint): Binary {
        return new Binary(this.bigintToBuffer(bigInt));
    }

    private bufferToBigInt(buffer: Buffer): bigint {
        return BigInt(`0x${buffer.toString('hex')}`);
    }

    private binaryToBigInt(binary: Binary): bigint {
        return this.bufferToBigInt(Buffer.from(binary.buffer));
    }

    private convertToDb(data: IMempoolTransactionObj): IMempoolTransaction {
        return {
            ...data,
            identifier: this.bigIntToBinary(data.identifier),
            data: new Binary(data.data),
        };
    }

    private convertToObj(data: IMempoolTransaction): IMempoolTransactionObj {
        return {
            ...data,
            identifier: this.binaryToBigInt(data.identifier),
            data: data.data.buffer,
        };
    }
}
