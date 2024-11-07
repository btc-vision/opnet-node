import { Logger } from '@btc-vision/bsi-common';
import { VMManager } from '../../../vm/VMManager.js';
import { VMStorage } from '../../../vm/storage/VMStorage.js';
import { Transaction } from '../transaction/Transaction.js';
import { OPNetTransactionTypes } from '../transaction/enums/OPNetTransactionTypes.js';
import { AbstractSpecialManager } from './managers/AbstractSpecialManager.js';

type Managers = Partial<{
    [key in OPNetTransactionTypes]: AbstractSpecialManager<key>;
}>;

export class SpecialManager extends Logger {
    public readonly logColor: string = '#afeeee';
    protected readonly vmStorage: VMStorage;

    private readonly managers: Managers = {};

    public constructor(protected readonly vmManager: VMManager) {
        super();

        this.vmStorage = vmManager.getVMStorage();

        // DISABLED WBTC 2024-11-07
        //this.managers[OPNetTransactionTypes.WrapInteraction] = new WrapManager(this.vmStorage);
    }

    public requireAdditionalSteps(type: OPNetTransactionTypes): boolean {
        return !!this.managers[type];
    }

    public async execute(transaction: Transaction<OPNetTransactionTypes>): Promise<void> {
        const type = transaction.transactionType;

        const manager = this.managers[type];
        if (!manager) {
            throw new Error(`Special manager for type ${type} not found`);
        }

        await manager.execute(transaction);
    }

    public reset(): void {
        for (const manager of Object.values(this.managers)) {
            manager.reset();
        }
    }
}
