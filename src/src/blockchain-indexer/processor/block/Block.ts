import { Address, MemorySlotPointer } from '@btc-vision/bsi-binary';
import { BlockDataWithTransactionData, TransactionData } from '@btc-vision/bsi-bitcoin-rpc';
import { DebugLevel, Logger } from '@btc-vision/bsi-common';
import { DataConverter } from '@btc-vision/bsi-db';
import bitcoin from 'bitcoinjs-lib';
import { Config } from '../../../config/Config.js';
import {
    BlockHeaderBlockDocument,
    BlockHeaderChecksumProof,
} from '../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { TransactionDocument } from '../../../db/interfaces/ITransactionDocument.js';
import { EvaluatedStates } from '../../../vm/evaluated/EvaluatedStates.js';
import { VMManager } from '../../../vm/VMManager.js';
import { OPNetTransactionTypes } from '../transaction/enums/OPNetTransactionTypes.js';
import { TransactionFactory } from '../transaction/transaction-factory/TransactionFactory.js';
import { TransactionSorter } from '../transaction/transaction-sorter/TransactionSorter.js';
import { Transaction } from '../transaction/Transaction.js';
import { DeploymentTransaction } from '../transaction/transactions/DeploymentTransaction.js';
import { InteractionTransaction } from '../transaction/transactions/InteractionTransaction.js';
import { BlockHeader } from './classes/BlockHeader.js';
import { ChecksumMerkle } from './merkle/ChecksumMerkle.js';
import { ZERO_HASH } from './types/ZeroValue.js';

export class Block extends Logger {
    // Block Header
    public readonly header: BlockHeader;

    // We create an array here instead of a map to be able to sort the transactions by their order in the block
    protected transactions: Transaction<OPNetTransactionTypes>[] = [];

    // Allow us to keep track of errored transactions
    protected readonly erroredTransactions: Set<TransactionData> = new Set();

    // Ensure that the block is processed only once
    protected processed: boolean = false;

    // Ensure that the block is executed once
    protected executed: boolean = false;

    // Private
    private readonly transactionFactory: TransactionFactory = new TransactionFactory();
    private readonly transactionSorter: TransactionSorter = new TransactionSorter();

    #_storageRoot: string | undefined;
    #_storageProofs: Map<Address, Map<MemorySlotPointer, string[]>> | undefined;

    #_receiptRoot: string | undefined;
    #_receiptProofs: Map<Address, Map<string, string[]>> | undefined;

    #_checksumMerkle: ChecksumMerkle = new ChecksumMerkle();
    #_checksumProofs: BlockHeaderChecksumProof | undefined;

    #_previousBlockChecksum: string | undefined;

    constructor(
        protected readonly rawBlockData: BlockDataWithTransactionData,
        protected readonly network: bitcoin.networks.Network,
    ) {
        super();

        this.header = new BlockHeader(rawBlockData);
    }

    private _reverted: boolean = false;

    public get reverted(): boolean {
        return this._reverted;
    }

    /** Block Getters */
    public get hash(): string {
        return this.header.hash;
    }

    public get height(): bigint {
        return this.header.height;
    }

    public get previousBlockChecksum(): string {
        if (!this.#_previousBlockChecksum) {
            throw new Error('Previous block checksum not found');
        }

        return this.#_previousBlockChecksum;
    }

    public get previousBlockHash(): string {
        return this.header.previousBlockHash;
    }

    public get receiptRoot(): string {
        if (this.#_receiptRoot === undefined) {
            throw new Error('Receipt root not found');
        }

        return this.#_receiptRoot;
    }

    public get receiptProofs(): Map<Address, Map<string, string[]>> {
        if (!this.#_receiptProofs) {
            throw new Error('Storage proofs not found');
        }

        return this.#_receiptProofs;
    }

    public get storageRoot(): string {
        if (!this.#_storageRoot) {
            throw new Error('Storage root not found');
        }

        return this.#_storageRoot;
    }

    public get storageProofs(): Map<Address, Map<MemorySlotPointer, string[]>> {
        if (!this.#_storageProofs) {
            throw new Error('Storage proofs not found');
        }

        return this.#_storageProofs;
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

    public get checksumRoot(): string {
        return this.#_checksumMerkle.root;
    }

    public get checksumProofs(): BlockHeaderChecksumProof {
        if (!this.#_checksumProofs) {
            throw new Error(
                'Checksum proofs are not calculated yet. Please deserialize the block first.',
            );
        }

        return this.#_checksumProofs;
    }

    public getBlockHeaderDocument(): BlockHeaderBlockDocument {
        return {
            checksumRoot: this.checksumRoot,
            checksumProofs: this.checksumProofs,

            bits: this.header.bits,
            nonce: this.header.nonce,

            previousBlockHash: this.header.previousBlockHash,
            previousBlockChecksum: this.previousBlockChecksum,

            receiptRoot: this.receiptRoot,

            txCount: this.header.nTx,
            hash: this.header.hash,
            height: DataConverter.toDecimal128(this.height),

            storageRoot: this.storageRoot,

            strippedSize: this.header.strippedSize,
            version: this.version,
            size: this.size,
            weight: this.weight,
            merkleRoot: this.merkleRoot,
            time: this.time,
            medianTime: this.medianTime,
        };
    }

    /** Block Processing */
    public deserialize(): void {
        this.ensureNotProcessed();

        // First, we have to create transaction object corresponding to the transactions types in the block
        this.createTransactions();

        if (this.erroredTransactions.size > 0) {
            this.error(
                `Failed to parse ${this.erroredTransactions.size} transactions. Proceed with caution. This may lead to bad indexing.`,
            );
        }

        console.log(`This block have ${this.transactions.length} transactions before sorting`);

        // Then, we can sort the transactions by their priority
        this.transactions = this.transactionSorter.sortTransactions(this.transactions);

        if (Config.DEBUG_LEVEL >= DebugLevel.INFO) {
            this.info(
                `Processing block ${this.hash} containing ${this.transactions.length} transaction(s) at height ${this.height}`,
            );
        }
    }

    /** Block Execution */
    public async execute(vmManager: VMManager): Promise<boolean> {
        this.ensureNotExecuted();

        // Prepare the vm for the block execution
        await vmManager.prepareBlock(this.height);

        try {
            // Execute each transaction of the block.
            await this.executeTransactions(vmManager);

            /** We must update the evaluated states, if there were no changes, then we mark the block as empty. */
            const states: EvaluatedStates = await vmManager.updateEvaluatedStates();
            if (states && states.storage && states.storage.size()) {
                await this.processBlockStates(states, vmManager);
            } else {
                await this.onEmptyBlock(vmManager);
            }

            return true;
        } catch (e) {
            const error: Error = e as Error;
            this.error(`Something went wrong while executing the block: ${error.stack}`);

            await this.revertBlock(vmManager);

            return false;
        }
    }

    protected async onEmptyBlock(vmManager: VMManager): Promise<void> {
        this.#_storageRoot = ZERO_HASH;
        this.#_storageProofs = new Map();

        this.#_receiptRoot = ZERO_HASH;
        this.#_receiptProofs = new Map();

        await this.signBlock(vmManager);
    }

    /** Block States Processing */
    protected async processBlockStates(
        states: EvaluatedStates,
        vmManager: VMManager,
    ): Promise<void> {
        try {
            if (!states) {
                throw new Error('Block have no states');
            }

            const storageTree = states.storage;
            if (!storageTree) {
                throw new Error('Storage tree not found');
            }

            const proofs = storageTree.getProofs();
            this.#_storageRoot = storageTree.root;
            this.#_storageProofs = proofs;

            const proofsReceipt = states.receipts.getProofs();
            this.#_receiptRoot = states.receipts.root;
            this.#_receiptProofs = proofsReceipt;

            await this.signBlock(vmManager);
        } catch (e) {
            const error: Error = e as Error;
            this.error(`Something went wrong while executing the block: ${error.stack}`);

            await this.revertBlock(vmManager);
        }
    }

    /** Transactions Execution */
    protected async executeTransactions(vmManager: VMManager): Promise<void> {
        if (Config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
            this.log(`Executing ${this.transactions.length} transactions.`);
        }

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
            /** We must create a transaction receipt. */
            transaction.receipt = await vmManager.executeTransaction(this.height, transaction);
        } catch (e) {
            const error: Error = e as Error;
            this.error(`Failed to execute transaction ${transaction.txid}: ${error.stack}`);

            transaction.revert = error;
        }
    }

    /** We execute deployment transactions with this method */
    protected async executeDeploymentTransaction(
        transaction: DeploymentTransaction,
        vmManager: VMManager,
    ): Promise<void> {
        try {
            await vmManager.deployContract(this.height, transaction);
        } catch (e) {
            const error: Error = e as Error;
            this.error(`Failed to deploy contract ${transaction.txid}: ${error.message}`);

            transaction.revert = error;
        }
    }

    private assignReceiptProofsToTransactions(): void {
        if (!this.#_receiptProofs) {
            throw new Error('Receipt proofs not found');
        }

        for (const transaction of this.transactions) {
            if (transaction.transactionType === OPNetTransactionTypes.Interaction) {
                const interactionTransaction = transaction as InteractionTransaction;
                const contractProofs = this.#_receiptProofs.get(
                    interactionTransaction.contractAddress,
                );

                if (!contractProofs) {
                    // Transaction reverted.
                    continue;
                }

                const proofs = contractProofs.get(interactionTransaction.transactionId);
                interactionTransaction.setReceiptProofs(proofs);
            }
        }
    }

    private async signBlock(vmManager: VMManager): Promise<void> {
        this.assignReceiptProofsToTransactions();

        /** We must fetch the previous block checksum */
        const previousBlockChecksum: string | undefined =
            await vmManager.getPreviousBlockChecksumOfHeight(this.height);

        if (!previousBlockChecksum) {
            throw new Error(
                `[DATA CORRUPTED] The previous block checksum of block ${this.height} is not found.`,
            );
        }

        this.#_previousBlockChecksum = previousBlockChecksum;

        this.#_checksumMerkle.setBlockData(
            this.header.previousBlockHash,
            this.#_previousBlockChecksum,
            this.hash,
            this.merkleRoot,
            this.storageRoot,
            this.receiptRoot,
        );

        this.#_checksumProofs = this.#_checksumMerkle.getProofs();

        // And finally, we can save the transactions
        await this.saveTransactions(vmManager);

        await vmManager.terminateBlock(this);
    }

    private async saveTransactions(vmManager: VMManager): Promise<void> {
        if (Config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug(
                `Block ${this.height} signed successfully. Checksum root: ${this.checksumRoot}. Saving ${this.transactions.length} transactions.`,
            );
        }

        let transactionData: TransactionDocument<OPNetTransactionTypes>[] = [];
        for (const transaction of this.transactions) {
            transactionData.push(transaction.toDocument());
        }

        await vmManager.saveTransactions(this.height, transactionData);

        if (Config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.success(`All transactions of block ${this.height} saved successfully.`);
        }
    }

    private async revertBlock(vmManager: VMManager): Promise<void> {
        this._reverted = true;

        await vmManager.revertBlock();
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

        for (let i = 0; i < this.rawBlockData.tx.length; i++) {
            const rawTransactionData = this.rawBlockData.tx[i];

            try {
                const transaction = this.transactionFactory.parseTransaction(
                    rawTransactionData,
                    this.hash,
                    this.height,
                    this.network,
                );
                transaction.originalIndex = i;

                this.transactions.push(transaction);
            } catch (e) {
                const error: Error = e as Error;
                this.error(
                    `Failed to parse transaction ${rawTransactionData.txid}: ${error.stack}`,
                );

                this.erroredTransactions.add(rawTransactionData);
            }
        }

        // Free up some memory, we don't need the raw transaction data anymore
        this.rawBlockData.tx = [];
    }
}
