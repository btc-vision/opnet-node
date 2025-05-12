import { AnyBulkWriteOperation, Binary, ClientSession, Collection, Db, Filter } from 'mongodb';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';
import { PublicKeyDocument } from '../interfaces/PublicKeyDocument.js';
import { ExtendedBaseRepository } from './ExtendedBaseRepository.js';
import { ProcessUnspentTransactionList } from './UnspentTransactionRepository.js';
import { Network, networks, payments, toXOnly } from '@btc-vision/bitcoin';
import { TransactionOutput } from '../../blockchain-indexer/processor/transaction/inputs/TransactionOutput.js';
import { NetworkConverter } from '../../config/network/NetworkConverter.js';
import { Address, AddressVerificator, EcKeyPair } from '@btc-vision/transaction';
import {
    IPubKeyNotFoundError,
    IPublicKeyInfoResult,
    PublicKeyInfo,
} from '../../api/json-rpc/types/interfaces/results/address/PublicKeyInfoResult.js';
import fs from 'fs';
import { Config } from '../../config/Config.js';
import { IContractDocument } from '../documents/interfaces/IContractDocument.js';

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
        const promises: Promise<PublicKeyDocument | IPubKeyNotFoundError>[] = [];
        for (let i = 0; i < addressOrPublicKeys.length; i++) {
            promises.push(this.getKeyInfo(addressOrPublicKeys[i]));
        }

        const results = await Promise.safeAll(promises);
        const pubKeyData: IPublicKeyInfoResult = {};

        for (let i = 0; i < addressOrPublicKeys.length; i++) {
            let key = addressOrPublicKeys[i];
            const result: PublicKeyDocument | IPubKeyNotFoundError = results[i];

            if ('error' in result) {
                key = key.replace('0x', '');

                const isValid = AddressVerificator.isValidPublicKey(key, this.network);
                if (isValid) {
                    const bufferKey = Buffer.from(key, 'hex');
                    if (key.length === 64) {
                        pubKeyData[key] = {
                            tweakedPubkey: key,

                            p2tr: this.tweakedPubKeyToAddress(bufferKey, this.network),
                        } as PublicKeyInfo;
                    } else if (key.length === 66) {
                        const tweaked = this.tweakPublicKey(Buffer.from(key, 'hex'));

                        const ecKeyPair = EcKeyPair.fromPublicKey(bufferKey, this.network);
                        const p2pkh = EcKeyPair.getLegacyAddress(ecKeyPair, this.network);
                        const p2shp2wpkh = EcKeyPair.getLegacySegwitAddress(
                            ecKeyPair,
                            this.network,
                        );
                        const p2wpkh = EcKeyPair.getP2WPKHAddress(ecKeyPair, this.network);

                        pubKeyData[key] = {
                            originalPubKey: key,
                            tweakedPubkey: tweaked.toString('hex'),
                            p2tr: this.tweakedPubKeyToAddress(tweaked, this.network),
                            p2pkh,
                            p2shp2wpkh,
                            p2wpkh,
                            lowByte: tweaked[0],
                        } as PublicKeyInfo;
                    }
                }

                if (!pubKeyData[key]) {
                    pubKeyData[key] = result;
                }
            } else {
                pubKeyData[key] = this.convertToPublicKeysInfo(result);
            }
        }

        return pubKeyData;
    }

    public async addTweakedPublicKey(tweaked: Buffer, session?: ClientSession): Promise<void> {
        const filter = {
            tweakedPublicKey: new Binary(tweaked),

            p2tr: this.tweakedPubKeyToAddress(tweaked, this.network),
        };

        await this.updatePartialWithFilter(
            filter,
            {
                $set: filter,
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

    protected tweakPublicKey(publicKey: Buffer): Buffer {
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

    private getContractCollection(): Collection<IContractDocument> {
        return this._db.collection(OPNetCollections.Contracts);
    }

    private convertToPublicKeysInfo(publicKey: PublicKeyDocument): PublicKeyInfo {
        return {
            lowByte: publicKey.lowByte,
            originalPubKey: publicKey.publicKey?.toString('hex'),
            tweakedPubkey: publicKey.tweakedPublicKey.toString('hex'),
            p2pkh: publicKey.p2pkh,
            p2pkhUncompressed: publicKey.p2pkhUncompressed,
            p2pkhHybrid: publicKey.p2pkhHybrid,
            p2shp2wpkh: publicKey.p2shp2wpkh,
            p2tr: publicKey.p2tr,
            p2wpkh: publicKey.p2wpkh,
        };
    }

    private async getKeyInfoFromContracts(
        key: string,
    ): Promise<PublicKeyDocument | IPubKeyNotFoundError> {
        try {
            const filter: Filter<IContractDocument> = {
                $or: [
                    { contractAddress: key },
                    { contractTweakedPublicKey: new Binary(Buffer.from(key, 'hex')) },
                ],
            };

            const resp = await this.getContractCollection().findOne(filter, {
                projection: {
                    contractAddress: 1,
                    contractTweakedPublicKey: 1,
                },
            });

            if (!resp) {
                throw new Error('Public key not found');
            }

            return this.convertContractObjectToPublicKeyDocument(resp);
        } catch {
            return {
                error: 'Public key not found',
            };
        }
    }

    private convertContractObjectToPublicKeyDocument(
        contract: IContractDocument,
    ): PublicKeyDocument {
        return {
            tweakedPublicKey: contract.contractTweakedPublicKey as Binary,
            p2tr: contract.contractAddress,
        };
    }

    private async getKeyInfo(key: string): Promise<PublicKeyDocument | IPubKeyNotFoundError> {
        try {
            const keyBuffer = new Binary(Buffer.from(key, 'hex'));
            const filter: Filter<PublicKeyDocument> = {
                $or: [
                    { p2tr: key },
                    { tweakedPublicKey: keyBuffer },
                    { publicKey: keyBuffer },
                    { p2pkh: key },
                    { p2shp2wpkh: key },
                    { p2wpkh: key },
                    { p2pkhUncompressed: key },
                    { p2pkhHybrid: key },
                ],
            };

            return await this.getOne(filter);
        } catch {
            return await this.getKeyInfoFromContracts(key);
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

    private addPubKey(publicKeys: PublicKeyDocument[], publicKey: Buffer, txId: Buffer): void {
        const str = publicKey.toString('hex');
        if (this.cache.has(str)) return;

        try {
            const tweakedPublicKey = this.tweakPublicKey(publicKey);
            const tweakedPublicKeyStr = tweakedPublicKey.toString('hex').slice(2);
            if (this.cache.has(tweakedPublicKeyStr)) {
                return;
            }

            if (tweakedPublicKeyStr !== str) {
                this.cache.add(tweakedPublicKeyStr);
            }

            this.cache.add(str);

            const p2tr = this.tweakedPubKeyToAddress(tweakedPublicKey, this.network);
            const address = new Address(publicKey);

            const p2pkh = this.getP2PKH(publicKey, this.network);
            const p2pkhHybrid = this.getP2PKH(address.toHybridPublicKeyBuffer(), this.network);

            const p2pkhUncompressed = this.getP2PKH(address.toUncompressedBuffer(), this.network);

            const p2shp2wpkh = address.p2shp2wpkh(this.network);
            const p2wpkh = address.p2wpkh(this.network);

            publicKeys.push({
                publicKey: new Binary(publicKey),
                tweakedPublicKey: new Binary(toXOnly(tweakedPublicKey)),
                lowByte: tweakedPublicKey[0],
                p2tr: p2tr,
                p2pkh: p2pkh,
                p2pkhUncompressed: p2pkhUncompressed,
                p2pkhHybrid: p2pkhHybrid,
                p2shp2wpkh: p2shp2wpkh,
                p2wpkh: p2wpkh,
            });
        } catch (err) {
            const e = err as Error;
            this.error(
                `error in tx (${e.message})`,
                publicKey.toString('hex'),
                txId.toString('hex'),
            );
        }
    }

    private getP2PKH(publicKey: Buffer | Uint8Array, network: Network = networks.bitcoin): string {
        const wallet = payments.p2pkh({ pubkey: Buffer.from(publicKey), network: network });
        if (!wallet.address) {
            throw new Error('Failed to generate wallet');
        }

        return wallet.address;
    }

    private reportNonStandardScript(type: string, script: string, txId: Buffer): void {
        // write the data to a file that can be checked later on.
        if (Config.DEV_MODE && !script.endsWith('ae')) {
            fs.appendFileSync('non-standard-scripts.txt', `${txId.toString('hex')}: ${script}\n`);

            this.warn(`Unknown script type: ${type}`);
        }
    }

    private decodeOutput(
        publicKeys: PublicKeyDocument[],
        output: TransactionOutput,
        type: string,
        txId: Buffer,
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
            case 'witness_mweb_hogaddr': {
                // ignore.
                break;
            }
            case 'nonstandard': {
                this.reportNonStandardScript(type, output.scriptPubKey.hex, txId);
                break;
            }
            default: {
                this.reportNonStandardScript(type, output.scriptPubKey.hex, txId);
                break;
            }
        }
    }
}
