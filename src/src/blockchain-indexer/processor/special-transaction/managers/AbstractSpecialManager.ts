import { Logger } from '@btc-vision/bsi-common';
import { Transaction } from '../../transaction/Transaction.js';
import { OPNetTransactionTypes } from '../../transaction/enums/OPNetTransactionTypes.js';
import { VMStorage } from '../../../../vm/storage/VMStorage.js';

export abstract class AbstractSpecialManager<T extends OPNetTransactionTypes> extends Logger {
    public abstract managerType: T;

    public readonly logColor: string = '#afeeee';

    protected constructor(protected readonly vmStorage: VMStorage) {
        super();
    }

    public abstract execute(transaction: Transaction<OPNetTransactionTypes>): Promise<void>;

    public abstract reset(): void;
}
