import { BlockDataWithTransactionData, TransactionData } from '@btc-vision/bsi-bitcoin-rpc';
import { Logger } from '@btc-vision/bsi-common';
import bitcoin from 'bitcoinjs-lib';
import { VMManager } from '../../../vm/VMManager.js';
import { OPNetTransactionTypes } from '../transaction/enums/OPNetTransactionTypes.js';
import { TransactionFactory } from '../transaction/transaction-factory/TransactionFactory.js';
import { TransactionSorter } from '../transaction/transaction-sorter/TransactionSorter.js';
import { Transaction } from '../transaction/Transaction.js';
import { DeploymentTransaction } from '../transaction/transactions/DeploymentTransaction.js';
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
    protected readonly revertedTransactions: Map<
        InteractionTransaction | DeploymentTransaction,
        Error
    > = new Map();

    // Ensure that the block is processed only once
    protected processed: boolean = false;

    // Ensure that the block is executed once
    protected executed: boolean = false;

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

    public get height(): bigint {
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

    /** Block Processing */
    public deserialize(): void {
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
    }

    /** Block Execution */
    public async execute(vmManager: VMManager): Promise<void> {
        this.ensureNotExecuted();

        // Prepare the vm for the block execution
        await vmManager.prepareBlock(this.height);

        try {
            // Execute each transaction of the block.
            await this.executeTransactions(vmManager);
        } catch (e) {
            const error: Error = e as Error;
            this.error(`Something went wrong while executing the block: ${error.message}`);

            await vmManager.revertBlock();
        } finally {
            // We terminate the execution of the block
            await vmManager.terminateBlock();
        }
    }

    /** Transactions Execution */
    protected async executeTransactions(vmManager: VMManager): Promise<void> {
        this.log(`Executing ${this.transactions.length} transactions.`);

        for (const _transaction of this.transactions) {
            switch (_transaction.transactionType) {
                case OPNetTransactionTypes.Interaction: {
                    const interactionTransaction = _transaction as InteractionTransaction;

                    await this.executeInteractionTransaction(interactionTransaction, vmManager);
                    break;
                }
                case OPNetTransactionTypes.Deployment: {
                    const deploymentTransaction = _transaction as DeploymentTransaction;

                    await this.executeDeploymentTransaction(deploymentTransaction, vmManager);
                    break;
                }
                case OPNetTransactionTypes.Generic: {
                    break;
                }
                default: {
                    throw new Error(
                        `Unsupported transaction type: ${_transaction.transactionType}`,
                    );
                }
            }
        }
    }

    /** We execute interaction transactions with this method */
    protected async executeInteractionTransaction(
        transaction: InteractionTransaction,
        vmManager: VMManager,
    ): Promise<void> {
        try {
        } catch (e) {
            const error: Error = e as Error;

            this.error(`Failed to execute transaction ${transaction.hash}: ${error.message}`);

            this.revertedTransactions.set(transaction, error);
        }
    }

    /** We execute deployment transactions with this method */
    protected async executeDeploymentTransaction(
        transaction: DeploymentTransaction,
        vmManager: VMManager,
    ): Promise<void> {
        try {
            await vmManager.deployContract(transaction);
        } catch (e) {
            const error: Error = e as Error;

            this.error(`Failed to deploy contract ${transaction.hash}: ${error.message}`);

            this.revertedTransactions.set(transaction, error);
        }
    }

    private ensureNotProcessed(): void {
        if (this.processed) {
            throw new Error('Block already processed');
        }

        this.processed = true;
    }

    private ensureNotExecuted(): void {
        if (this.executed) {
            throw new Error('Block already executed');
        }

        this.executed = true;
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
