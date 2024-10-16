import { AnyBulkWriteOperation, Collection, Db, Filter } from 'mongodb';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';
import { PublicKeyDocument } from '../interfaces/PublicKeyDocument.js';
import { ExtendedBaseRepository } from './ExtendedBaseRepository.js';
import { ProcessUnspentTransactionList } from './UnspentTransactionRepository.js';
import { CURVE, Point, utils } from '@noble/secp256k1';
import { taggedHash } from 'bitcoinjs-lib/src/crypto.js';

export class PublicKeysRepository extends ExtendedBaseRepository<PublicKeyDocument> {
    public readonly logColor: string = '#afeeee';

    public constructor(db: Db) {
        super(db);
    }

    public async processPublicKeys(transactions: ProcessUnspentTransactionList): Promise<void> {
        const publicKeys: PublicKeyDocument[] = [];

        for (const transaction of transactions) {
            for (const tx of transaction.transactions) {
                const outputs = tx.outputs;

                for (const output of outputs) {
                    console.log(output);
                }
            }
        }

        await this.addPubKeys(publicKeys);
    }

    protected tweakPublicKey(compressedPubKeyHex: string): string {
        // Convert the compressed public key hex string to a Point on the curve
        let P = Point.fromHex(compressedPubKeyHex);

        // Ensure the point has an even y-coordinate
        if (!P.hasEvenY()) {
            // Negate the point to get an even y-coordinate
            P = P.negate();
        }

        // Get the x-coordinate (32 bytes) of the point
        const x = P.toRawBytes(true).slice(1); // Remove the prefix byte

        // Compute the tweak t = H_tapTweak(x)
        const tHash = taggedHash('TapTweak', Buffer.from(x));
        const t = utils.mod(BigInt('0x' + Buffer.from(tHash).toString('hex')), CURVE.n);

        // Compute Q = P + t*G (where G is the generator point)
        const Q = P.add(Point.BASE.multiply(t));

        // Return the tweaked public key in compressed form (hex string)
        return Q.toHex(true);
    }

    protected async addPubKeys(documents: PublicKeyDocument[]): Promise<void> {
        const bulkWriteOperations: AnyBulkWriteOperation<PublicKeyDocument>[] = documents.map(
            (document) => {
                const filter: Filter<PublicKeyDocument> = {};
                if (document.publicKey) {
                    filter.publicKey = document.publicKey;
                } else if (document.tweakedPublicKey) {
                    filter.tweakedPublicKey = document.tweakedPublicKey;
                }

                return {
                    updateOne: {
                        filter: filter,
                        update: {
                            $set: document,
                        },
                        upsert: true,
                    },
                };
            },
        );

        if (!documents.length) {
            return;
        }

        this.log(`Saving ${documents.length} public keys`);

        const chunks = this.chunkArray(bulkWriteOperations, 500);
        await this.waitForAllSessionsCommitted();

        const promises = [];
        for (const chunk of chunks) {
            promises.push(this.bulkWrite(chunk));
        }

        await Promise.all(promises);
    }

    protected override getCollection(): Collection<PublicKeyDocument> {
        return this._db.collection(OPNetCollections.PublicKeys);
    }
}
