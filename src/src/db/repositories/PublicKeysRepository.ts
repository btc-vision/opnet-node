import {
    AnyBulkWriteOperation,
    Binary,
    ClientSession,
    Collection,
    Db,
    Document,
    Filter,
} from 'mongodb';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';
import { PublicKeyDocument } from '../interfaces/PublicKeyDocument.js';
import { ExtendedBaseRepository } from './ExtendedBaseRepository.js';
import { ProcessUnspentTransactionList } from './UnspentTransactionRepository.js';
import { fromHex, Network, networks, payments, toHex, toXOnly } from '@btc-vision/bitcoin';
import { createPublicKey, createXOnlyPublicKey } from '@btc-vision/ecpair';
import { TransactionOutput } from '../../blockchain-indexer/processor/transaction/inputs/TransactionOutput.js';
import { NetworkConverter } from '../../config/network/NetworkConverter.js';
import { Address, AddressVerificator, EcKeyPair } from '@btc-vision/transaction';
import {
    IPubKeyNotFoundError,
    IPublicKeyInfoResult,
    PublicKeyInfo,
} from '../../api/json-rpc/types/interfaces/results/address/PublicKeyInfoResult.js';
import { Config } from '../../config/Config.js';
import { IContractDocument } from '../documents/interfaces/IContractDocument.js';
import { MLDSAPublicKeyDocument } from '../interfaces/IMLDSAPublicKey.js';

interface PublicKeyWithMLDSA extends PublicKeyDocument {
    mldsa?: MLDSAPublicKeyDocument | null;
}

interface MLDSALookupEntry {
    type: 'hashed' | 'legacy';
    key: Binary;
}

const DEAD_ADDRESS = Address.dead();

export class PublicKeysRepository extends ExtendedBaseRepository<PublicKeyDocument> {
    public readonly logColor: string = '#afeeee';

    private readonly network: Network = NetworkConverter.getNetwork();
    private readonly cache: Set<string> = new Set();
    private readonly MAX_CACHE_SIZE: number = 200_000;

    public constructor(db: Db) {
        super(db);
    }

    public clearCache(): void {
        this.cache.clear();
    }

    public async getAddressOrPublicKeysInformation(
        addressOrPublicKeys: string[],
    ): Promise<IPublicKeyInfoResult> {
        const promises: Promise<PublicKeyWithMLDSA | IPubKeyNotFoundError>[] = [];
        for (let i = 0; i < addressOrPublicKeys.length; i++) {
            promises.push(this.getKeyInfo(addressOrPublicKeys[i]));
        }

        const results = await Promise.safeAll(promises);

        const mldsaLookups: Map<number, MLDSALookupEntry> = new Map();

        for (let i = 0; i < addressOrPublicKeys.length; i++) {
            const result = results[i];
            if ('error' in result) {
                const key = addressOrPublicKeys[i].replace('0x', '');
                if (!AddressVerificator.isValidPublicKey(key, this.network)) continue;

                const keyBytes = fromHex(key);
                if (key.length === 64) {
                    // 32 bytes = mldsaHashedPublicKey, lookup by hashedPublicKey
                    mldsaLookups.set(i, { type: 'hashed', key: new Binary(keyBytes) });
                } else if (key.length === 66) {
                    // 33 bytes = compressed EC pubkey, tweak and lookup by legacyPublicKey
                    const tweakedXOnly = toXOnly(createPublicKey(this.tweakPublicKey(keyBytes)));
                    mldsaLookups.set(i, { type: 'legacy', key: new Binary(tweakedXOnly) });
                }
            }
        }

        const mldsaPromises: Promise<[number, MLDSAPublicKeyDocument | null]>[] = [];
        for (const [index, entry] of mldsaLookups) {
            if (entry.type === 'hashed') {
                mldsaPromises.push(
                    this.fetchMLDSAByHashedKey(entry.key).then((mldsa) => [index, mldsa]),
                );
            } else {
                mldsaPromises.push(
                    this.fetchMLDSAByLegacyKey(entry.key).then((mldsa) => [index, mldsa]),
                );
            }
        }

        const mldsaResults = await Promise.safeAll(mldsaPromises);
        const mldsaMap: Map<number, MLDSAPublicKeyDocument | null> = new Map(mldsaResults);

        const pubKeyData: IPublicKeyInfoResult = {};

        for (let i = 0; i < addressOrPublicKeys.length; i++) {
            const originalKey = addressOrPublicKeys[i];
            const result = results[i];

            if ('error' in result) {
                const key = originalKey.replace('0x', '');
                if (!AddressVerificator.isValidPublicKey(key, this.network)) {
                    pubKeyData[key] = result;
                    continue;
                }

                const keyBytes = fromHex(key);
                const mldsa = mldsaMap.get(i) ?? null;

                if (key.length === 64) {
                    // 32 bytes = mldsaHashedPublicKey input, always derive p2op from it
                    const info: PublicKeyInfo = {
                        p2op: this.p2op(keyBytes, this.network),
                        mldsaHashedPublicKey: key,
                    };

                    if (mldsa) {
                        info.mldsaLevel = mldsa.level;
                        info.mldsaPublicKey = mldsa.publicKey
                            ? toHex(new Uint8Array(mldsa.publicKey.buffer))
                            : null;

                        if (mldsa.tweakedPublicKey) {
                            const tweakedKeyBytes = new Uint8Array(mldsa.tweakedPublicKey.buffer);
                            info.tweakedPubkey = toHex(tweakedKeyBytes);
                            info.p2tr = this.tweakedPubKeyToAddress(tweakedKeyBytes, this.network);
                        }

                        if (mldsa.legacyPublicKey) {
                            const legacyKeyBytes = new Uint8Array(mldsa.legacyPublicKey.buffer);
                            if (legacyKeyBytes.length === 33) {
                                const ecKeyPair = EcKeyPair.fromPublicKey(
                                    legacyKeyBytes,
                                    this.network,
                                );
                                const tweakedKey = this.tweakPublicKey(legacyKeyBytes);
                                info.originalPubKey = toHex(legacyKeyBytes);
                                info.p2pkh = EcKeyPair.getLegacyAddress(ecKeyPair, this.network);
                                /*info.p2shp2wpkh = EcKeyPair.getLegacySegwitAddress(
                                    ecKeyPair,
                                    this.network,
                                );*/
                                info.p2wpkh = EcKeyPair.getP2WPKHAddress(ecKeyPair, this.network);
                                info.lowByte = tweakedKey[0];
                            }
                        }
                    }

                    pubKeyData[key] = info;
                } else if (key.length === 66) {
                    // 33 bytes = compressed EC pubkey, derive all address types
                    pubKeyData[key] = this.buildPublicKeyInfo(keyBytes, key, mldsa);
                } else {
                    pubKeyData[key] = result;
                }
            } else {
                pubKeyData[originalKey] = this.convertToPublicKeysInfo(result);
            }
        }

        return pubKeyData;
    }

    public async addTweakedPublicKey(tweaked: Uint8Array, session?: ClientSession): Promise<void> {
        const filter = {
            tweakedPublicKey: new Binary(tweaked),
            p2tr: this.tweakedPubKeyToAddress(tweaked, this.network),
        };

        await this.updatePartialWithFilter(
            filter,
            {
                $set: {
                    ...filter,
                    p2op: this.p2op(tweaked, this.network),
                },
            },
            session,
        );
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

    protected tweakedPubKeyToAddress(tweakedPubKeyBuffer: Uint8Array, network: Network): string {
        const { address } = payments.p2tr({
            pubkey: toXOnly(createPublicKey(tweakedPubKeyBuffer)),
            network: network,
        });

        if (!address) {
            throw new Error('Failed to generate Taproot address');
        }

        return address;
    }

    protected tweakPublicKey(publicKey: Uint8Array): Uint8Array {
        if (publicKey.length === 65) {
            publicKey = EcKeyPair.fromPublicKey(publicKey).publicKey;
        }

        return EcKeyPair.tweakPublicKey(publicKey);
    }

    protected async addPubKeys(documents: PublicKeyDocument[]): Promise<void> {
        const bulkWriteOperations: AnyBulkWriteOperation<PublicKeyDocument>[] = documents.map(
            (document) => {
                const filter: Filter<PublicKeyDocument> = {
                    tweakedPublicKey: document.tweakedPublicKey,
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

        const chunks = this.chunkArray(bulkWriteOperations, 5000);
        const promises = [];
        for (const chunk of chunks) {
            promises.push(this.bulkWrite(chunk));
        }

        await Promise.safeAll(promises);
    }

    protected override getCollection(): Collection<PublicKeyDocument> {
        return this._db.collection(OPNetCollections.PublicKeys);
    }

    /*private buildPublicKeyInfoFromMLDSA(
        legacyTweakedKey: Buffer,
        hashedKey: Buffer,
        mldsa: MLDSAPublicKeyDocument,
    ): PublicKeyInfo {
        // legacyTweakedKey (tweakedPublicKey) -> p2tr
        // hashedKey (mldsaHashedPublicKey) -> p2op
        return {
            tweakedPubkey: legacyTweakedKey.toString('hex'),
            p2tr: this.tweakedPubKeyToAddress(legacyTweakedKey, this.network),
            p2op: this.p2op(hashedKey, this.network),
            mldsaHashedPublicKey: hashedKey.toString('hex'),
            mldsaLevel: mldsa.level,
            mldsaPublicKey: mldsa.publicKey
                ? Buffer.from(mldsa.publicKey.buffer).toString('hex')
                : null,
        };
    }*/

    private buildPublicKeyInfo(
        keyBytes: Uint8Array,
        originalPubKey: string | null,
        mldsa: MLDSAPublicKeyDocument | null,
    ): PublicKeyInfo {
        // originalPubKey (33-byte compressed EC) -> p2pkh, p2shp2wpkh, p2wpkh, lowByte
        // tweaked from originalPubKey -> p2tr
        // mldsa.hashedPublicKey -> p2op (when MLDSA exists)
        const isCompressed = originalPubKey !== null;
        const tweakedKey = isCompressed ? this.tweakPublicKey(keyBytes) : null;
        const tweakedXOnly = tweakedKey ? toXOnly(createPublicKey(tweakedKey)) : keyBytes;

        const info: PublicKeyInfo = {
            tweakedPubkey: toHex(tweakedXOnly),
            p2tr: this.tweakedPubKeyToAddress(tweakedXOnly, this.network),
        };

        if (isCompressed && tweakedKey) {
            const ecKeyPair = EcKeyPair.fromPublicKey(keyBytes, this.network);
            info.originalPubKey = originalPubKey;
            info.p2pkh = EcKeyPair.getLegacyAddress(ecKeyPair, this.network);
            //info.p2shp2wpkh = EcKeyPair.getLegacySegwitAddress(ecKeyPair, this.network);
            info.p2wpkh = EcKeyPair.getP2WPKHAddress(ecKeyPair, this.network);
            info.lowByte = tweakedKey[0];
        }

        if (mldsa) {
            info.mldsaHashedPublicKey = toHex(new Uint8Array(mldsa.hashedPublicKey.buffer));
            info.mldsaLevel = mldsa.level;
            info.mldsaPublicKey = mldsa.publicKey
                ? toHex(new Uint8Array(mldsa.publicKey.buffer))
                : null;
            info.p2op = mldsa?.hashedPublicKey
                ? this.p2op(new Uint8Array(mldsa.hashedPublicKey.buffer), this.network)
                : undefined;
        }

        return info;
    }

    private p2op(hashedKey: Uint8Array, network: Network): string | undefined {
        const realAddress = createXOnlyPublicKey(hashedKey);

        const addy = new Address(realAddress);
        return addy.p2op(network);
    }

    private getContractCollection(): Collection<IContractDocument> {
        return this._db.collection(OPNetCollections.Contracts);
    }

    private convertToPublicKeysInfo(publicKey: PublicKeyWithMLDSA): PublicKeyInfo {
        const base: PublicKeyInfo = {
            lowByte: publicKey.lowByte,
            originalPubKey: publicKey.publicKey
                ? toHex(new Uint8Array(publicKey.publicKey.buffer))
                : undefined,
            tweakedPubkey: toHex(new Uint8Array(publicKey.tweakedPublicKey.buffer)),
            p2pkh: publicKey.p2pkh,
            //p2pkhUncompressed: publicKey.p2pkhUncompressed,
            //p2pkhHybrid: publicKey.p2pkhHybrid,
            //p2shp2wpkh: publicKey.p2shp2wpkh,
            p2tr: publicKey.p2tr,
            p2op: publicKey.p2op,
            p2wpkh: publicKey.p2wpkh,
        };

        if (publicKey.mldsa) {
            base.mldsaHashedPublicKey = toHex(
                new Uint8Array(publicKey.mldsa.hashedPublicKey.buffer),
            );
            base.mldsaLevel = publicKey.mldsa.level;
            base.mldsaPublicKey = publicKey.mldsa.publicKey
                ? toHex(new Uint8Array(publicKey.mldsa.publicKey.buffer))
                : null;
        }

        return base;
    }

    private async getKeyInfoFromContracts(
        key: string,
    ): Promise<PublicKeyWithMLDSA | IPubKeyNotFoundError> {
        try {
            const filter: Filter<IContractDocument> = {
                $or: [{ contractAddress: key }, { contractPublicKey: new Binary(fromHex(key)) }],
            };

            const resp = await this.getContractCollection().findOne(filter, {
                projection: {
                    contractAddress: 1,
                    contractPublicKey: 1,
                },
            });

            if (!resp) {
                throw new Error('Public key not found');
            }

            return await this.convertContractObjectToPublicKeyDocument(resp);
        } catch {
            return {
                error: 'Public key not found',
            };
        }
    }

    private async convertContractObjectToPublicKeyDocument(
        contract: IContractDocument,
    ): Promise<PublicKeyWithMLDSA> {
        const contractPublicKeyBytes = new Uint8Array(
            (contract.contractPublicKey as Binary).buffer,
        );
        const p2tr = this.tweakedPubKeyToAddress(contractPublicKeyBytes, this.network);

        const baseDocument: PublicKeyWithMLDSA = {
            tweakedPublicKey: contract.contractPublicKey as Binary,
            p2tr,
            p2op: contract.contractAddress,
        };

        const mldsa = await this.fetchMLDSAByLegacyKey(contract.contractPublicKey as Binary);
        if (mldsa) {
            baseDocument.mldsa = mldsa;
        }

        return baseDocument;
    }

    private async fetchMLDSAByLegacyKey(
        tweakedPublicKey: Binary,
    ): Promise<MLDSAPublicKeyDocument | null> {
        const mldsaCollection = this._db.collection<MLDSAPublicKeyDocument>(
            OPNetCollections.MLDSAPublicKeys,
        );

        const result = await mldsaCollection.findOne({ tweakedPublicKey: tweakedPublicKey });

        return result ?? null;
    }

    private async fetchMLDSAByHashedKey(
        hashedPublicKey: Binary,
    ): Promise<MLDSAPublicKeyDocument | null> {
        const mldsaCollection = this._db.collection<MLDSAPublicKeyDocument>(
            OPNetCollections.MLDSAPublicKeys,
        );

        const result = await mldsaCollection.findOne({ hashedPublicKey });

        return result ?? null;
    }

    private async getKeyInfo(key: string): Promise<PublicKeyWithMLDSA | IPubKeyNotFoundError> {
        try {
            const keyBinary = new Binary(fromHex(key));
            const filter: Filter<PublicKeyDocument> = {
                $or: [
                    { p2op: key },
                    { p2tr: key },
                    { tweakedPublicKey: keyBinary },
                    { publicKey: keyBinary },
                    { p2pkh: key },
                    //{ p2shp2wpkh: key },
                    { p2wpkh: key },
                    //{ p2pkhUncompressed: key },
                    //{ p2pkhHybrid: key },
                ],
            };

            return await this.getOneWithMLDSA(filter);
        } catch {
            return await this.getKeyInfoFromContracts(key);
        }
    }

    private async getOneWithMLDSA(filter: Filter<PublicKeyDocument>): Promise<PublicKeyWithMLDSA> {
        const pipeline: Document[] = [
            { $match: filter },
            { $limit: 1 },
            {
                $lookup: {
                    from: OPNetCollections.MLDSAPublicKeys,
                    localField: 'tweakedPublicKey',
                    foreignField: 'tweakedPublicKey',
                    as: 'mldsaData',
                },
            },
            {
                $addFields: {
                    mldsa: { $arrayElemAt: ['$mldsaData', 0] },
                },
            },
            { $project: { mldsaData: 0 } },
        ];

        const results = await this.getCollection()
            .aggregate<PublicKeyWithMLDSA>(pipeline)
            .toArray();

        if (!results.length) {
            throw new Error('Public key not found');
        }

        return results[0];
    }

    private addSchnorrPublicKey(publicKeys: PublicKeyDocument[], publicKey: Uint8Array): void {
        const publicKeyHex = toHex(publicKey);
        if (this.cache.has(publicKeyHex)) {
            return;
        }

        this.cache.add(publicKeyHex);

        publicKeys.push({
            tweakedPublicKey: new Binary(publicKey),
            p2tr: this.tweakedPubKeyToAddress(publicKey, this.network),
            p2op: this.p2op(publicKey, this.network),
        });
    }

    private isTaprootControlBlock(data: Uint8Array): boolean {
        const controlByte = data[0];

        return controlByte === 0xc0 || controlByte === 0xc1;
    }

    private addPubKey(
        publicKeys: PublicKeyDocument[],
        publicKey: Uint8Array,
        txId: Uint8Array,
    ): void {
        const str = toHex(publicKey);
        if (this.cache.has(str)) return;

        try {
            const tweakedPublicKey = this.tweakPublicKey(publicKey);
            const tweakedPublicKeyStr = toHex(tweakedPublicKey).slice(2);
            if (this.cache.has(tweakedPublicKeyStr)) {
                return;
            }

            if (tweakedPublicKeyStr !== str) {
                this.cache.add(tweakedPublicKeyStr);
            }

            this.cache.add(str);

            const p2tr = this.tweakedPubKeyToAddress(tweakedPublicKey, this.network);
            const p2op = this.p2op(tweakedPublicKey, this.network);
            const address = new Address(DEAD_ADDRESS, publicKey);

            const p2pkh = this.getP2PKH(publicKey, this.network);
            //const p2pkhHybrid = this.getP2PKH(address.toHybridPublicKeyBuffer(), this.network);

            //const p2pkhUncompressed = this.getP2PKH(address.toUncompressedBuffer(), this.network);

            //const p2shp2wpkh = address.p2shp2wpkh(this.network);
            const p2wpkh = address.p2wpkh(this.network);

            publicKeys.push({
                publicKey: new Binary(publicKey),
                tweakedPublicKey: new Binary(toXOnly(createPublicKey(tweakedPublicKey))),
                lowByte: tweakedPublicKey[0],
                p2tr: p2tr,
                p2op: p2op,
                p2pkh: p2pkh,
                //p2pkhUncompressed: p2pkhUncompressed,
                //p2pkhHybrid: p2pkhHybrid,
                //p2shp2wpkh: p2shp2wpkh,
                p2wpkh: p2wpkh,
            });
        } catch (err) {
            const e = err as Error;

            let msgOrStack: string = e.message;
            if (Config.DEV_MODE) {
                msgOrStack = e.stack ?? e.message;
            }

            this.error(`error in tx (${toHex(txId)}) (${msgOrStack})`, toHex(publicKey));
        }
    }

    private getP2PKH(publicKey: Uint8Array, network: Network = networks.bitcoin): string {
        const wallet = payments.p2pkh({ pubkey: createPublicKey(publicKey), network: network });
        if (!wallet.address) {
            throw new Error('Failed to generate wallet');
        }

        return wallet.address;
    }

    /*private reportNonStandardScript(type: string, script: string, txId: Buffer): void {
        if (Config.DEV_MODE && !script.endsWith('ae')) {
            fs.appendFileSync('non-standard-scripts.txt', `${txId.toString('hex')}: ${script}\n`);

            this.warn(`Unknown script type: ${type}`);
        }
    }*/

    private decodeOutput(
        publicKeys: PublicKeyDocument[],
        output: TransactionOutput,
        type: string,
        txId: Uint8Array,
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
                break;
            }
            case 'witness_v0_keyhash': {
                break;
            }
            case 'witness_v1_taproot': {
                if (output.decodedSchnorrPublicKey) {
                    this.addSchnorrPublicKey(publicKeys, output.decodedSchnorrPublicKey);
                }
                break;
            }
            case 'witness_v0_scripthash': {
                break;
            }
            case 'scripthash': {
                break;
            }
            case 'nulldata': {
                break;
            }
            case 'witness_mweb_hogaddr': {
                break;
            }
            case 'witness_unknown': {
                break;
            }
            case 'nonstandard': {
                //this.reportNonStandardScript(type, output.scriptPubKey.hex, txId);
                break;
            }
            default: {
                //this.reportNonStandardScript(type, output.scriptPubKey.hex, txId);
                break;
            }
        }
    }
}
