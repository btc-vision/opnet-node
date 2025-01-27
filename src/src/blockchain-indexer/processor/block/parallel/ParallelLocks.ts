import { Transaction } from '../../transaction/Transaction.js';
import { OPNetTransactionTypes } from '../../transaction/enums/OPNetTransactionTypes.js';
import { Mutex } from 'async-mutex';
import { InteractionTransaction } from '../../transaction/transactions/InteractionTransaction.js';

import { ContractEvaluation } from '../../../../vm/runtime/classes/ContractEvaluation.js';

/**
 * An ephemeral result from the parallel execution of a single transaction:
 */
export interface EphemeralTxResult {
    transaction: Transaction<OPNetTransactionTypes>;
    revertError: Error | null;
    usedGas: bigint;
    evaluationReceipt: ContractEvaluation | null;
}

/**
 * Tracks a simple "lock" for each contract address to ensure
 * that two transactions touching the same address do not run concurrently.
 * This is a minimal demonstration. Real solutions often require deeper logic.
 */
export class ParallelLocks<TType extends OPNetTransactionTypes> {
    private addressLocks: Map<string, Mutex> = new Map();

    /**
     * Acquire a lock on the contract address of the transaction, run the callback,
     * then release. This ensures no two parallel txs share the same address.
     */
    public async runTxWithLock(
        tx: Transaction<TType>,
        callback: () => Promise<void>,
    ): Promise<void> {
        if ('contractAddress' in tx) {
            const address = (tx as unknown as InteractionTransaction).contractAddress;

            let lock = this.addressLocks.get(address);
            if (!lock) {
                lock = new Mutex();
                this.addressLocks.set(address, lock);
            }

            // Acquire the lock, run the callback, release
            const release = await lock.acquire();
            try {
                await callback();
            } finally {
                release();
            }
        } else {
            await callback();
        }
    }
}
