import { AnyBulkWriteOperation, Binary, Collection, Db, Filter } from 'mongodb';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';
import { PublicKeyDocument } from '../interfaces/PublicKeyDocument.js';
import { ExtendedBaseRepository } from './ExtendedBaseRepository.js';
import { ProcessUnspentTransactionList } from './UnspentTransactionRepository.js';
import { CURVE, Point, utils } from '@noble/secp256k1';
import { taggedHash } from '@btc-vision/bitcoin/src/crypto.js';
import { TransactionOutput } from '../../blockchain-indexer/processor/transaction/inputs/TransactionOutput.js';
import { Network, payments } from '@btc-vision/bitcoin';
import { toXOnly } from '@btc-vision/bitcoin/src/psbt/bip371.js';
import { NetworkConverter } from '../../config/network/NetworkConverter.js';
import { EcKeyPair } from '@btc-vision/transaction';
import {
    IPubKeyNotFoundError,
    IPublicKeyInfoResult,
    PublicKeyInfo,
} from '../../api/json-rpc/types/interfaces/results/address/PublicKeyInfoResult.js';

export class PublicKeysRepository extends ExtendedBaseRepository<PublicKeyDocument> {
    public readonly logColor: string = '#afeeee';

    private readonly network: Network = NetworkConverter.getNetwork();
    private readonly cache: Set<string> = new Set();
    private readonly MAX_CACHE_SIZE: number = 100_000;

    public constructor(db: Db) {
        super(db);
    }

    public clearCache(): void {
        this.cache.clear();
    }

    public async getAddressOrPublicKeysInformation(
        addressOrPublicKeys: string[],
    ): Promise<IPublicKeyInfoResult> {
        const promises: Promise<PublicKeyDocument | IPubKeyNotFoundError>[] = [];
        for (let i = 0; i < addressOrPublicKeys.length; i++) {
            promises.push(this.getKeyInfo(addressOrPublicKeys[i]));
        }

        const results = await Promise.all(promises);
        const pubKeyData: IPublicKeyInfoResult = {};

        for (let i = 0; i < addressOrPublicKeys.length; i++) {
            const key = addressOrPublicKeys[i];
            const result: PublicKeyDocument | IPubKeyNotFoundError = results[i];

            if ('error' in result) {
                pubKeyData[key] = result;
            } else {
                pubKeyData[key] = this.convertToPublicKeysInfo(result);
            }
        }

        return pubKeyData;
    }

    public async processPublicKeys(transactions: ProcessUnspentTransactionList): Promise<void> {
        const publicKeys: PublicKeyDocument[] = [];

        if (this.cache.size > this.MAX_CACHE_SIZE) {
            this.clearCache();
        }

        for (const transaction of transactions) {
            for (const tx of transaction.transactions) {
                const inputs = tx.inputs;
                const outputs = tx.outputs;

                for (const input of inputs) {
                    if (input.decodedPubKey) {
                        if (this.isTaprootControlBlock(input.decodedPubKey)) {
                            // Filter out taproot control blocks
                            continue;
                        }

                        this.addPubKey(publicKeys, input.decodedPubKey, tx.id);
                    }
                }

                for (const output of outputs) {
                    const type = output.scriptPubKey.type;
                    if (!type) {
                        continue;
                    }

                    this.decodeOutput(publicKeys, output, type, tx.id);
                }
            }
        }

        if (publicKeys.length) {
            await this.addPubKeys(publicKeys);
        }
    }

    protected tweakedPubKeyToAddress(tweakedPubKeyBuffer: Buffer, network: Network): string {
        // Generate the Taproot address using the p2tr payment method
        const { address } = payments.p2tr({
            pubkey: toXOnly(tweakedPubKeyBuffer),
            network: network,
        });

        if (!address) {
            throw new Error('Failed to generate Taproot address');
        }

        return address;
    }

    protected tweakPublicKey(compressedPubKeyHex: Buffer): Buffer {
        // Convert the compressed public key hex string to a Point on the curve
        let P = Point.fromHex(compressedPubKeyHex.toString('hex'));

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
        return Buffer.from(Q.toHex(true), 'hex');
    }

    protected async addPubKeys(documents: PublicKeyDocument[]): Promise<void> {
        const bulkWriteOperations: AnyBulkWriteOperation<PublicKeyDocument>[] = documents.map(
            (document) => {
                const filter: Filter<PublicKeyDocument> = {
                    tweakedPublicKey: document.tweakedPublicKey,
                    p2tr: document.p2tr,
                };

                return {
                    updateOne: {
                        filter: filter,
                        update: {
                            $set: document,
                        },
                        upsert: true,
                        hint: 'tweakedPublicKey_1',
                    },
                };
            },
        );

        this.log(`Saving ${documents.length} public keys`);

        const chunks = this.chunkArray(bulkWriteOperations, 500);

        const promises = [];
        for (const chunk of chunks) {
            promises.push(this.bulkWrite(chunk));
        }

        await Promise.all(promises);
    }

    protected override getCollection(): Collection<PublicKeyDocument> {
        return this._db.collection(OPNetCollections.PublicKeys);
    }

    private convertToPublicKeysInfo(publicKey: PublicKeyDocument): PublicKeyInfo {
        return {
            lowByte: publicKey.lowByte,
            originalPubKey: publicKey.publicKey?.toString('hex'),
            tweakedPubkey: publicKey.tweakedPublicKey.toString('hex'),
            p2pkh: publicKey.p2pkh,
            p2shp2wpkh: publicKey.p2shp2wpkh,
            p2tr: publicKey.p2tr,
            p2wpkh: publicKey.p2wpkh,
        };
    }

    private async getKeyInfo(key: string): Promise<PublicKeyDocument | IPubKeyNotFoundError> {
        try {
            const filter: Filter<PublicKeyDocument> = {
                $or: [
                    { p2tr: key },
                    { p2pkh: key },
                    { p2shp2wpkh: key },
                    { p2wpkh: key },
                    { tweakedPublicKey: new Binary(Buffer.from(key, 'hex')) },
                    { publicKey: new Binary(Buffer.from(key, 'hex')) },
                ],
            };

            return await this.getOne(filter);
        } catch {
            return {
                error: 'Public key not found',
            };
        }
    }

    private async getOne(filter: Filter<PublicKeyDocument>): Promise<PublicKeyDocument> {
        const resp = await this.getCollection().findOne(filter);

        if (!resp) {
            throw new Error('Public key not found');
        }

        return resp;
    }

    private addSchnorrPublicKey(publicKeys: PublicKeyDocument[], publicKey: Buffer): void {
        const publicKeyHex = publicKey.toString('hex');
        if (this.cache.has(publicKeyHex)) {
            return;
        }

        this.cache.add(publicKeyHex);

        publicKeys.push({
            tweakedPublicKey: new Binary(publicKey),

            p2tr: this.tweakedPubKeyToAddress(publicKey, this.network),
        });
    }

    private isTaprootControlBlock(data: Buffer): boolean {
        const controlByte = data[0];

        return controlByte === 0xc0 || controlByte === 0xc1;
    }

    private addPubKey(publicKeys: PublicKeyDocument[], publicKey: Buffer, txId: string): void {
        const str = publicKey.toString('hex');
        if (this.cache.has(str)) return;

        try {
            const tweakedPublicKey = this.tweakPublicKey(publicKey);
            const tweakedPublicKeyStr = tweakedPublicKey.toString('hex').slice(2);
            if (this.cache.has(tweakedPublicKeyStr)) {
                return;
            }

            const p2tr = this.tweakedPubKeyToAddress(tweakedPublicKey, this.network);
            const ecKeyPair = EcKeyPair.fromPublicKey(publicKey, this.network);

            const p2pkh = EcKeyPair.getLegacyAddress(ecKeyPair, this.network);
            const p2shp2wpkh = EcKeyPair.getLegacySegwitAddress(ecKeyPair, this.network);

            const p2wpkh = EcKeyPair.getP2WPKHAddress(ecKeyPair, this.network);

            this.cache.add(str);
            this.cache.add(tweakedPublicKeyStr);

            publicKeys.push({
                publicKey: new Binary(publicKey),
                tweakedPublicKey: new Binary(toXOnly(tweakedPublicKey)),
                lowByte: tweakedPublicKey[0],
                p2tr: p2tr,
                p2pkh: p2pkh,
                p2shp2wpkh: p2shp2wpkh,
                p2wpkh: p2wpkh,
            });
        } catch (err) {
            const e = err as Error;
            this.error(`error in tx (${e.message})`, publicKey.toString('hex'), txId);
        }
    }

    private decodeOutput(
        publicKeys: PublicKeyDocument[],
        output: TransactionOutput,
        type: string,
        txId: string,
    ): void {
        switch (type) {
            case 'pubkey': {
                if (output.decodedPublicKeys && output.decodedPublicKeys.length) {
                    this.addPubKey(publicKeys, output.decodedPublicKeys[0], txId);
                }
                break;
            }
            case 'pubkeyhash': {
                break;
            }
            case 'multisig': {
                // TODO: Implement
                break;
            }
            case 'witness_v0_keyhash': {
                // TODO: Implement
                break;
            }
            case 'witness_v1_taproot': {
                if (output.decodedSchnorrPublicKey) {
                    this.addSchnorrPublicKey(publicKeys, output.decodedSchnorrPublicKey);
                }
                break;
            }
            case 'witness_v0_scripthash': {
                // TODO: Implement
                break;
            }
            case 'scripthash': {
                // TODO: Implement
                break;
            }
            case 'nulldata': {
                // ignore.
                break;
            }
            default: {
                this.warn(`Unknown script type: ${type}`);
                break;
            }
        }
    }
}
