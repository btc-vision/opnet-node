import { BaseRepository, DebugLevel } from '@btc-vision/bsi-common';
import { AggregateOptions, Binary, ClientSession, Collection, Db, Decimal128 } from 'mongodb';
import { IWBTCUTXODocument } from '../interfaces/IWBTCUTXODocument.js';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';
import { DataConverter } from '@btc-vision/bsi-db';
import { WBTCUTXOAggregation } from '../../vm/storage/databases/aggregation/WBTCUTXOSAggregation.js';
import { Address } from '@btc-vision/bsi-binary';
import { IVaultDocument } from '../interfaces/IVaultDocument.js';
import {
    QueryVaultAggregation,
    VaultsByHashes,
} from '../../vm/storage/databases/aggregation/QueryVaultAggregation.js';
import { Config } from '../../config/Config.js';
import { currentConsensusConfig } from '../../poa/configurations/OPNetConsensus.js';
import { UnwrapTargetConsolidation } from '../../poa/equoitions/UnwrapTargetConsolidation.js';

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
    private readonly vaultAggregationByHash: QueryVaultAggregation = new QueryVaultAggregation();

    private cachedVaultQuery: Promise<SelectedUTXOs | undefined> | undefined;

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

    /** In case someone sends a lot of requests, we can cache the query for a short period of time. */
    public async queryVaultsUTXOs(
        requestedAmount: bigint,
        consolidationAcceptance: bigint,
        _currentSession?: ClientSession,
    ): Promise<SelectedUTXOs | undefined> {
        if (this.cachedVaultQuery) {
            this.warn(
                `High load detected. Used cached query for vault request. Increase your capacity. You should not see this message often.`,
            );
            return await this.cachedVaultQuery;
        }

        this.cachedVaultQuery = this._queryVaultsUTXOs(
            requestedAmount,
            consolidationAcceptance,
            _currentSession,
        );
        const result = await this.cachedVaultQuery;

        setTimeout(() => {
            this.cachedVaultQuery = undefined;
        }, 25); // cache for 25ms. this will prevent massive spamming of the database.

        return result;
    }

    public async deleteWBTCUTXOs(blockId: bigint): Promise<void> {
        const criteria = {
            blockId: {
                $gte: DataConverter.toDecimal128(blockId),
            },
        };

        await this.delete(criteria);
    }

    public orderPublicKeys(publicKeys: Buffer[]): Buffer[] {
        return publicKeys.sort((a, b) => a.compare(b));
    }

    public async queryVaultsFromHashes(hashes: string[]): Promise<VaultsByHashes[]> {
        try {
            const aggregation = this.vaultAggregationByHash.getAggregation(hashes);
            const collection = this.getCollection();
            const options: AggregateOptions = this.getOptions() as AggregateOptions;
            options.allowDiskUse = true;

            const aggregatedDocument = collection.aggregate<
                Omit<VaultsByHashes, 'publicKeys' | 'utxoDetails'> & {
                    publicKeys: Binary[];
                    utxoDetails: { hash: string; value: Decimal128 }[];
                }
            >(aggregation, options);

            const results = await aggregatedDocument.toArray();
            return results.map((result) => {
                return {
                    vault: result.vault,
                    publicKeys: this.orderPublicKeys(
                        result.publicKeys.map((pk) => Buffer.from(pk.value())),
                    ),
                    minimum: result.minimum,
                    utxoDetails: result.utxoDetails.map((utxo) => {
                        return {
                            hash: utxo.hash,
                            value: DataConverter.fromDecimal128(utxo.value),
                        };
                    }),
                };
            });
        } catch (e) {
            if (Config.DEBUG_LEVEL >= DebugLevel.WARN) {
                this.warn(`Can not fetch vaults from hashes: ${e}`);
            }

            throw new Error(`Unable to query vaults from hashes.`);
        }
    }

    public async queryVaults(
        vaults: Address[],
        currentSession?: ClientSession,
    ): Promise<IVaultDocument[]> {
        const criteria = {
            vault: {
                $in: vaults,
            },
        };

        const opts = this.getOptions();
        if (currentSession) opts.session = currentSession;

        return await this.getVaultCollection().find(criteria, opts).toArray();
    }

    protected override getCollection(): Collection<IWBTCUTXODocument> {
        return this._db.collection(OPNetCollections.WBTCUTXO);
    }

    protected getVaultCollection(): Collection<IVaultDocument> {
        return this._db.collection(OPNetCollections.Vaults);
    }

    private async _queryVaultsUTXOs(
        requestedAmount: bigint,
        minConsolidationAcceptance: bigint,
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

            const upperConsolidationAcceptanceLimit =
                UnwrapTargetConsolidation.calculateVaultTargetConsolidationAmount(
                    requestedAmount,
                    currentConsensusConfig.VAULT_MINIMUM_AMOUNT,
                    minConsolidationAcceptance,
                ) - 1n;

            // Fees are prepaid up to a certain value. We need to add the consolidation fees to the requested amount.
            let currentAmount: bigint = 0n;
            let consolidating: boolean = false;
            let selectedUTXOs: IWBTCUTXODocument[] = [];
            let consolidatedInputs: IWBTCUTXODocument[] = [];
            let consolidationAmount: bigint = 0n;

            const results = await aggregatedDocument.toArray();
            if (!(!results || results.length === 0)) {
                for (const utxo of results) {
                    const utxoValue = DataConverter.fromDecimal128(utxo.value);
                    if (!consolidating) {
                        currentAmount += utxoValue;
                        selectedUTXOs.push(utxo);

                        requestedAmount +=
                            currentConsensusConfig.UNWRAP_CONSOLIDATION_PREPAID_FEES_SAT;

                        if (currentAmount >= requestedAmount) {
                            consolidating = true;
                            requestedAmount -=
                                currentConsensusConfig.UNWRAP_CONSOLIDATION_PREPAID_FEES_SAT;

                            consolidationAmount = requestedAmount - currentAmount;

                            if (minConsolidationAcceptance === 0n) {
                                this.warn(`minConsolidationAcceptance = 0`);
                                break;
                            }
                        }

                        continue;
                    } else if (
                        utxoValue + consolidationAmount <=
                        upperConsolidationAcceptanceLimit
                    ) {
                        consolidationAmount += utxoValue;
                        consolidatedInputs.push(utxo);

                        requestedAmount +=
                            currentConsensusConfig.UNWRAP_CONSOLIDATION_PREPAID_FEES_SAT;
                    }

                    const totalAmount: bigint = currentAmount + consolidationAmount;
                    const requiredAmount: bigint =
                        requestedAmount + upperConsolidationAcceptanceLimit;

                    // Minimum to consolidate is 2 UTXOs
                    if (
                        (totalAmount >= requiredAmount && consolidatedInputs.length >= 2) ||
                        consolidatedInputs.length >=
                            currentConsensusConfig.MAXIMUM_CONSOLIDATION_UTXOS
                    ) {
                        // TODO: ensure we don't end up with a lot of small UTXOs.
                        break;
                    }
                }
            }

            // Maximize the consolidation.
            if (
                consolidatedInputs.length &&
                consolidationAmount > upperConsolidationAcceptanceLimit
            ) {
                consolidatedInputs.pop();
            }

            if (consolidatedInputs.length > currentConsensusConfig.MAXIMUM_CONSOLIDATION_UTXOS) {
                consolidatedInputs = consolidatedInputs.slice(
                    0,
                    currentConsensusConfig.MAXIMUM_CONSOLIDATION_UTXOS,
                );
            }

            return await this.sortUTXOsByVaults(selectedUTXOs.concat(consolidatedInputs));
        } catch (e) {
            console.log('Can not fetch UTXOs', e);
        }

        return undefined;
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
        const hashes: string[] = [];

        for (const utxo of utxos) {
            const vault = utxo.vault;

            if (!hashes.includes(utxo.hash)) {
                hashes.push(utxo.hash);
            } else {
                throw new Error(`Duplicate hash found: ${utxo.hash}`);
            }

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
}
