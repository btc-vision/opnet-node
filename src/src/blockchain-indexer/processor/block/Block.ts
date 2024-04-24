import { BlockDataWithTransactionData, TransactionData } from '@btc-vision/bsi-bitcoin-rpc';
import { Logger } from '@btc-vision/bsi-common';
import bitcoin from 'bitcoinjs-lib';
import { OPNetTransactionTypes } from '../transaction/enums/OPNetTransactionTypes.js';
import { TransactionFactory } from '../transaction/transaction-factory/TransactionFactory.js';
import { TransactionSorter } from '../transaction/transaction-sorter/TransactionSorter.js';
import { Transaction } from '../transaction/Transaction.js';
import { InteractionTransaction } from '../transaction/transactions/InteractionTransaction.js';
import { BlockHeader } from './classes/BlockHeader.js';

export class Block extends Logger {
    // Block Header
    public readonly header: BlockHeader;

    // We create an array here instead of a map to be able to sort the transactions by their order in the block
    protected transactions: Transaction<OPNetTransactionTypes>[] = [];

    // Allow us to keep track of errored transactions
    protected readonly erroredTransactions: Set<TransactionData> = new Set();

    // Allow us to keep track of reverted transactions
    protected readonly revertedTransactions: Set<InteractionTransaction> = new Set();

    // Ensure that the block is processed only once
    protected processed: boolean = false;

    // Private
    private readonly transactionFactory: TransactionFactory = new TransactionFactory();
    private readonly transactionSorter: TransactionSorter = new TransactionSorter();

    constructor(
        protected readonly rawBlockData: BlockDataWithTransactionData,
        protected readonly network: bitcoin.networks.Network,
    ) {
        super();

        this.header = new BlockHeader(rawBlockData);
    }

    /** Block Getters */
    public get hash(): string {
        return this.header.hash;
    }

    public get height(): number {
        return this.header.height;
    }

    public get confirmations(): number {
        return this.header.confirmations;
    }

    public get version(): number {
        return this.header.version;
    }

    public get size(): number {
        return this.header.size;
    }

    public get weight(): number {
        return this.header.weight;
    }

    public get merkleRoot(): string {
        return this.header.merkleRoot;
    }

    public get time(): Date {
        return this.header.time;
    }

    public get medianTime(): Date {
        return this.header.medianTime;
    }

    /** Main processing method to process correctly bitcoin blocks */
    public async process(): Promise<void> {
        this.ensureNotProcessed();

        this.info(`Processing block ${this.hash} at height ${this.height}`);

        // First, we have to create transaction object corresponding to the transactions types in the block
        this.createTransactions();

        if (this.erroredTransactions.size > 0) {
            this.error(
                `Failed to parse ${this.erroredTransactions.size} transactions. Proceed with caution. This may lead to bad indexing.`,
            );
        }

        if (this.revertedTransactions.size > 0) {
            this.error(
                `Reverted ${this.revertedTransactions.size} transactions. Proceed with caution. This may lead to bad indexing.`,
            );
        }

        // Then, we can sort the transactions by their priority
        this.transactions = this.transactionSorter.sortTransactions(this.transactions);

        // Then, we must verify interaction transactions

        console.log(this.transactions[this.transactions.length - 1]);
    }

    private ensureNotProcessed(): void {
        if (this.processed) {
            throw new Error('Block already processed');
        }

        this.processed = true;
    }

    private pushInteractionTransactionToReverted(
        transaction: InteractionTransaction,
        reason: Error,
    ): void {
        this.revertedTransactions.add(transaction);

        this.error(`Failed to verify transaction ${transaction.hash}: ${reason.message}`);
    }

    private createTransactions(): void {
        if (this.transactions.length > 0) {
            throw new Error('Transactions are already created');
        }

        this.erroredTransactions.clear();
        this.revertedTransactions.clear();

        for (let i = 0; i < this.rawBlockData.tx.length; i++) {
            const rawTransactionData = this.rawBlockData.tx[i];

            try {
                const transaction = this.transactionFactory.parseTransaction(
                    rawTransactionData,
                    this.hash,
                    this.network,
                );
                transaction.originalIndex = i;

                this.transactions.push(transaction);
            } catch (e) {
                const error: Error = e as Error;
                this.error(
                    `Failed to parse transaction ${rawTransactionData.hash}: ${error.message}`,
                );

                this.erroredTransactions.add(rawTransactionData);
            }
        }
    }
}
