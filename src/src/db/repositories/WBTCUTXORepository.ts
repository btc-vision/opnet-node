import { BaseRepository } from '@btc-vision/bsi-common';
import { AggregateOptions, AggregationCursor, ClientSession, Collection, Db } from 'mongodb';
import { IWBTCUTXODocument } from '../interfaces/IWBTCUTXODocument.js';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';
import { DataConverter } from '@btc-vision/bsi-db';
import { WBTCUTXOAggregation } from '../../vm/storage/databases/aggregation/WBTCUTXOSAggregation.js';
import { Address } from '@btc-vision/bsi-binary';
import { IVaultDocument } from '../interfaces/IVaultDocument.js';

export interface VaultUTXOs {
    readonly vault: Address;
    readonly publicKeys: Address[];
    readonly minimum: number;
    readonly utxos: IWBTCUTXODocument[];
}

export type SelectedUTXOs = Map<Address, VaultUTXOs>;

export class WBTCUTXORepository extends BaseRepository<IWBTCUTXODocument> {
    public readonly logColor: string = '#afeeee';

    private readonly utxosAggregation: WBTCUTXOAggregation = new WBTCUTXOAggregation();

    constructor(db: Db) {
        super(db);
    }

    public async setWBTCUTXO(
        utxo: IWBTCUTXODocument,
        currentSession?: ClientSession,
    ): Promise<void> {
        const criteria = {
            hash: utxo.hash,
        };

        await this.updatePartial(criteria, utxo, currentSession);
    }

    public async queryVaultsUTXOs(
        requestedAmount: bigint,
        _currentSession?: ClientSession,
    ): Promise<SelectedUTXOs | undefined> {
        try {
            const aggregation = this.utxosAggregation.getAggregation();

            const collection = this.getCollection();
            const options: AggregateOptions = this.getOptions() as AggregateOptions;
            options.allowDiskUse = true;

            const aggregatedDocument = collection.aggregate<IWBTCUTXODocument>(
                aggregation,
                options,
            );

            let currentAmount: bigint = 0n;
            let fulfilled: boolean = false;
            let selectedUTXOs: IWBTCUTXODocument[] = [];
            do {
                const results = await this.nextBatch(aggregatedDocument);
                if (!results || results.length === 0) {
                    break;
                }

                for (const utxo of results) {
                    if (!utxo) {
                        fulfilled = true;
                        break;
                    }

                    currentAmount += DataConverter.fromDecimal128(utxo.value);
                    selectedUTXOs.push(utxo);

                    if (currentAmount >= requestedAmount) {
                        fulfilled = true;
                        break;
                    }
                }
            } while (!fulfilled);
            
            return await this.sortUTXOsByVaults(selectedUTXOs);
        } catch (e) {
            console.log('Can not fetch UTXOs', e);
        }

        return undefined;
    }

    public async deleteWBTCUTXOs(blockId: bigint): Promise<void> {
        const criteria = {
            blockId: {
                $gte: DataConverter.toDecimal128(blockId),
            },
        };

        await this.delete(criteria);
    }

    protected override getCollection(): Collection<IWBTCUTXODocument> {
        return this._db.collection(OPNetCollections.WBTCUTXO);
    }

    protected getVaultCollection(): Collection<IVaultDocument> {
        return this._db.collection(OPNetCollections.Vaults);
    }

    private async fetchVault(
        vault: Address,
        currentSession?: ClientSession,
    ): Promise<IVaultDocument | null> {
        const criteria = {
            vault: vault,
        };

        const opts = this.getOptions();
        if (currentSession) opts.session = currentSession;

        return this.getVaultCollection().findOne(criteria, opts);
    }

    private async sortUTXOsByVaults(
        utxos: IWBTCUTXODocument[],
    ): Promise<SelectedUTXOs | undefined> {
        const selectedUTXOs: SelectedUTXOs = new Map();
        const vaultCache: Map<Address, IVaultDocument> = new Map();

        for (const utxo of utxos) {
            const vault = utxo.vault;

            const vaultData = vaultCache.get(vault) ?? (await this.fetchVault(vault));
            if (!vaultData) {
                return undefined;
            }
            vaultCache.set(vault, vaultData);

            const publicKeys = vaultData.publicKeys.map((pk) => pk.toString('base64'));
            const minimum = vaultData.minimum;

            if (selectedUTXOs.has(vault)) {
                const vaultUTXOs = selectedUTXOs.get(vault);
                if (!vaultUTXOs) {
                    continue;
                }

                vaultUTXOs.utxos.push(utxo);
            } else {
                const vaultUTXOs: VaultUTXOs = {
                    vault: vault,
                    publicKeys: publicKeys,
                    minimum: minimum,
                    utxos: [utxo],
                };

                selectedUTXOs.set(vault, vaultUTXOs);
            }
        }

        return selectedUTXOs;
    }

    private async nextBatch(
        aggregatedDocument: AggregationCursor<IWBTCUTXODocument>,
    ): Promise<(IWBTCUTXODocument | null)[]> {
        const promises: Promise<IWBTCUTXODocument | null>[] = [];

        for (let i = 0; i < 1; i++) {
            promises.push(aggregatedDocument.next()); // TODO: fix when to low.
        }

        const res = await Promise.all(promises);
        return res.filter((r) => r !== null);
    }
}
