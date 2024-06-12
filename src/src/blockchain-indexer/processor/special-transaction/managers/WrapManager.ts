import { AbstractSpecialManager } from './AbstractSpecialManager.js';
import { VMStorage } from '../../../../vm/storage/VMStorage.js';
import { OPNetTransactionTypes } from '../../transaction/enums/OPNetTransactionTypes.js';
import { WrapTransaction } from '../../transaction/transactions/WrapTransaction.js';
import { Address } from '@btc-vision/bsi-binary';
import { IVaultDocument } from '../../../../db/interfaces/IVaultDocument.js';
import { DataConverter } from '@btc-vision/bsi-db';
import { IWBTCUTXODocument } from '../../../../db/interfaces/IWBTCUTXODocument.js';
import { Binary } from 'mongodb';

export class WrapManager extends AbstractSpecialManager<OPNetTransactionTypes.WrapInteraction> {
    public managerType: OPNetTransactionTypes.WrapInteraction =
        OPNetTransactionTypes.WrapInteraction;

    public readonly logColor: string = '#afeeee';
    private readonly cachedVaults: Set<Address> = new Set();

    public constructor(vmStorage: VMStorage) {
        super(vmStorage);
    }

    public async execute(transaction: WrapTransaction): Promise<void> {
        const promises: Promise<void>[] = [];
        if (!this.hasVault(transaction.vault)) {
            promises.push(this.addVault(transaction));
        }

        promises.push(this.addUTXO(transaction));

        await Promise.all(promises);
    }

    public reset(): void {
        this.cachedVaults.clear();
    }

    private hasVault(vault: Address): boolean {
        return this.cachedVaults.has(vault);
    }

    private async addUTXO(transaction: WrapTransaction): Promise<void> {
        const output = transaction.wrapOutput;
        if (output.address !== transaction.vault) {
            this.panic(
                `Output address does not match vault address: ${output.address} !== ${transaction.vault}`,
            );
        }

        const utxoData: IWBTCUTXODocument = {
            vault: transaction.vault,
            blockId: DataConverter.toDecimal128(transaction.blockHeight),
            value: DataConverter.toDecimal128(transaction.depositTotal),
            hash: transaction.hash,
            outputIndex: transaction.wrapIndex,
            output: Binary.createFromHexString(output.hex),
        };

        await this.vmStorage.setWBTCUTXO(utxoData);
    }

    private async addVault(transaction: WrapTransaction): Promise<void> {
        const vaultData: IVaultDocument = {
            vault: transaction.vault,
            firstSeen: DataConverter.toDecimal128(transaction.blockHeight),
            publicKeys: transaction.publicKeys,
            minimum: transaction.minimumSignatures,
        };

        this.cachedVaults.add(transaction.vault);

        await this.vmStorage.setVault(vaultData);
    }
}
