import { BaseRepository } from '@btc-vision/bsi-common';
import { ClientSession, Collection, Db, Filter } from 'mongodb';
import { IVaultDocument } from '../interfaces/IVaultDocument.js';
import { OPNetCollections } from '../indexes/required/IndexedCollection.js';
import { Address } from '@btc-vision/bsi-binary';
import { DataConverter } from '@btc-vision/bsi-db';

export class VaultRepository extends BaseRepository<IVaultDocument> {
    public readonly logColor: string = '#afeeee';

    constructor(db: Db) {
        super(db);
    }

    public async getVault(
        vault: Address,
        currentSession?: ClientSession,
    ): Promise<IVaultDocument | undefined> {
        const criteria: Filter<IVaultDocument> = {
            vault: vault,
        };

        return (await this.queryOne(criteria, currentSession)) ?? undefined;
    }

    public async setVault(vault: IVaultDocument, currentSession?: ClientSession): Promise<void> {
        const criteria: Filter<IVaultDocument> = {
            vault: vault.vault,
        };

        const vaultExists = await this.getVault(vault.vault, currentSession);
        if (vaultExists) {
            return;
        }

        await this.updatePartial(criteria, vault, currentSession);
    }

    public async deleteVaultsSeenAfter(firstSeen: bigint): Promise<void> {
        const criteria: Filter<IVaultDocument> = {
            firstSeen: { $gte: DataConverter.toDecimal128(firstSeen) },
        };

        await this.delete(criteria);
    }

    protected override getCollection(): Collection<IVaultDocument> {
        return this._db.collection(OPNetCollections.Vaults);
    }
}
