import { Address, MemorySlotPointer } from '@btc-vision/bsi-binary';
import { TransactionData } from '@btc-vision/bsi-bitcoin-rpc';
import { DebugLevel, Logger } from '@btc-vision/bsi-common';
import { DataConverter } from '@btc-vision/bsi-db';
import { Network } from 'bitcoinjs-lib';
import { Config } from '../../../config/Config.js';
import {
    BlockHeaderBlockDocument,
    BlockHeaderChecksumProof,
} from '../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { TransactionDocument } from '../../../db/interfaces/ITransactionDocument.js';
import { EvaluatedStates } from '../../../vm/evaluated/EvaluatedStates.js';
import { VMManager } from '../../../vm/VMManager.js';
import {
    OPNetInteractionTypeValues,
    OPNetTransactionTypes,
} from '../transaction/enums/OPNetTransactionTypes.js';
import { TransactionFactory } from '../transaction/transaction-factory/TransactionFactory.js';
import { TransactionSorter } from '../transaction/transaction-sorter/TransactionSorter.js';
import { Transaction } from '../transaction/Transaction.js';
import { DeploymentTransaction } from '../transaction/transactions/DeploymentTransaction.js';
import { InteractionTransaction } from '../transaction/transactions/InteractionTransaction.js';
import { BlockDataWithoutTransactionData, BlockHeader } from './classes/BlockHeader.js';
import { ChecksumMerkle } from './merkle/ChecksumMerkle.js';
import { ZERO_HASH } from './types/ZeroValue.js';
import { WrapTransaction } from '../transaction/transactions/WrapTransaction.js';
import { SpecialManager } from '../special-transaction/SpecialManager.js';
import { GenericTransaction } from '../transaction/transactions/GenericTransaction.js';
import { ICompromisedTransactionDocument } from '../../../db/interfaces/CompromisedTransactionDocument.js';
import { UnwrapTransaction } from '../transaction/transactions/UnwrapTransaction.js';
import { IWBTCUTXODocument, UsedUTXOToDelete } from '../../../db/interfaces/IWBTCUTXODocument.js';
import assert from 'node:assert';

export interface RawBlockParam {
    header: BlockDataWithoutTransactionData;
    abortController: AbortController;
    network: Network;
}

export interface DeserializedBlock extends Omit<RawBlockParam, 'abortController' | 'network'> {
    readonly rawTransactionData: TransactionData[];
    readonly transactionOrder?: string[];

    readonly abortController?: AbortController;
    readonly network?: Network;
}

export class Block extends Logger {
    // Block Header
    public readonly header: BlockHeader;

    public timeForTransactionExecution: number = 0;
    public timeForStateUpdate: number = 0;
    public timeForBlockProcessing: number = 0;
    public timeForGenericTransactions: number = 0;

    // We create an array here instead of a map to be able to sort the transactions by their order in the block
    protected transactions: Transaction<OPNetTransactionTypes>[] = [];

    // Allow us to keep track of errored transactions
    protected erroredTransactions: Set<TransactionData> = new Set();

    // Ensure that the block is processed only once
    protected processed: boolean = false;

    // Ensure that the block is executed once
    protected executed: boolean = false;

    protected readonly signal: AbortSignal;
    protected readonly network: Network;
    protected readonly abortController: AbortController;

    private rawTransactionData: TransactionData[] | undefined;

    // Private
    private readonly transactionFactory: TransactionFactory = new TransactionFactory();
    private readonly transactionSorter: TransactionSorter = new TransactionSorter();

    private genericTransactions: Transaction<OPNetTransactionTypes>[] = [];
    private opnetTransactions: Transaction<OPNetTransactionTypes>[] = [];
    private specialTransaction: Transaction<OPNetTransactionTypes>[] = [];

    private specialExecutionPromise: Promise<void> | undefined;

    #compromised: boolean = false;
    #_storageRoot: string | undefined;
    #_storageProofs: Map<Address, Map<MemorySlotPointer, string[]>> | undefined;

    #_receiptRoot: string | undefined;
    #_receiptProofs: Map<Address, Map<string, string[]>> | undefined;
    #_checksumMerkle: ChecksumMerkle = new ChecksumMerkle();

    #_checksumProofs: BlockHeaderChecksumProof | undefined;
    #_previousBlockChecksum: string | undefined;

    private saveGenericPromises: Promise<void>[] | undefined;

    constructor(params: RawBlockParam | DeserializedBlock) {
        super();

        if (!params.abortController) {
            throw new Error('Abort controller not found');
        }

        if (!params.network) {
            throw new Error('Network not found');
        }

        this.abortController = params.abortController;
        this.network = params.network;

        this.signal = this.abortController.signal;
        this.header = new BlockHeader(params.header);

        if ('rawTransactionData' in params) {
            this.setRawTransactionData(params.rawTransactionData);
            this.deserialize(params.transactionOrder);

            this.processed = true;
        }
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

    public get median(): bigint {
        return BigInt(this.header.medianTime.getTime());
    }

    public get timestamp(): number {
        return this.header.time.getTime();
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

    public get compromised(): boolean {
        return this.#compromised;
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

    public static fromJSON(data: DeserializedBlock): Block {
        return new Block(data);
    }

    public setRawTransactionData(rawTransactionData: TransactionData[]): void {
        this.rawTransactionData = rawTransactionData;

        // First, we have to create transaction object corresponding to the transactions types in the block
        this.createTransactions();
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
    public deserialize(transactionOrder?: string[]): void {
        this.ensureNotProcessed();

        if (Config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
            if (this.erroredTransactions.size > 0) {
                this.error(`Failed to parse ${this.erroredTransactions.size} transactions.`);
            }
        }

        if (transactionOrder) {
            // If the transaction order is provided, we can sort the transactions by their order
            this.transactions = this.transactionSorter.sortTransactionsByOrder(
                transactionOrder,
                this.transactions,
            );
        } else {
            // Then, we can sort the transactions by their priority
            this.transactions = this.transactionSorter.sortTransactions(this.transactions);
        }

        if (Config.DEBUG_LEVEL >= DebugLevel.TRACE) {
            this.info(
                `Processing block ${this.hash} containing ${this.transactions.length} transaction(s) at height ${this.height}`,
            );
        }

        this.defineGeneric();
    }

    public toJSON(): DeserializedBlock {
        if (!this.rawTransactionData) {
            throw new Error('Block data not found');
        }

        if (!this.processed) throw new Error('Block not processed');

        return {
            rawTransactionData: this.rawTransactionData,
            transactionOrder: this.transactions.map((t) => t.transactionId),
            header: this.header.toJSON(),
        };
    }

    /** Get all transactions hashes of this block */
    public getTransactionsHashes(): string[] {
        return this.transactions.map((transaction: Transaction<OPNetTransactionTypes>) => {
            return transaction.transactionId;
        });
    }

    public async insertPartialTransactions(vmManager: VMManager): Promise<void> {
        // temporary
        /*await vmManager.insertUTXOs(
            this.height,
            this.transactions.map((t) => t.toBitcoinDocument()),
        );*/

        this.saveGenericPromises = [this.saveGenericTransactions(vmManager)];

        if (!Config.INDEXER.DISABLE_UTXO_INDEXING) {
            this.saveGenericPromises.push(
                vmManager.insertUTXOs(
                    this.height,
                    this.transactions.map((t) => t.toBitcoinDocument()),
                ),
            );
        }
    }

    /** Block Execution */
    public async execute(vmManager: VMManager, specialManager: SpecialManager): Promise<boolean> {
        // Free up some memory, we don't need the raw transaction data anymore
        this.rawTransactionData = [];

        this.ensureNotExecuted();

        try {
            const timeBeforeExecution = Date.now();

            // Execute each transaction of the block.
            await this.executeTransactions(vmManager, specialManager);

            this.specialExecutionPromise = this.executeSpecialTransactions(specialManager);

            const timeAfterExecution = Date.now();
            this.timeForTransactionExecution = timeAfterExecution - timeBeforeExecution;

            /** We must update the evaluated states, if there were no changes, then we mark the block as empty. */
            const states: EvaluatedStates = await vmManager.updateEvaluatedStates();
            const updatedStatesAfterExecution = Date.now();
            this.timeForStateUpdate = updatedStatesAfterExecution - timeAfterExecution;

            this.verifyIfBlockAborted();

            if (states && states.receipts && states.receipts.size()) {
                await this.processBlockStates(states, vmManager);
            } else {
                await this.onEmptyBlock(vmManager);
            }

            this.verifyIfBlockAborted();

            const timeAfterBlockProcessing = Date.now();
            this.timeForBlockProcessing = timeAfterBlockProcessing - updatedStatesAfterExecution;

            const timeAfterGenericTransactions = Date.now();
            this.timeForGenericTransactions =
                timeAfterGenericTransactions - timeAfterBlockProcessing;

            return true;
        } catch (e) {
            const error: Error = e as Error;
            this.panic(
                `[execute] Something went wrong while executing the block: ${Config.DEV_MODE ? error.stack : error.message}`,
            );

            return false;
        }
    }

    public async finalizeBlock(vmManager: VMManager): Promise<boolean> {
        try {
            this.verifyIfBlockAborted();

            if (!this.saveGenericPromises) throw new Error('Generic promises not found');

            this.saveGenericPromises.push(this.saveOPNetTransactions(vmManager));

            // We must wait for the generic transactions to be saved before finalizing the block
            await vmManager.saveBlock(this);

            // We must wait for the generic transactions to be saved before finalizing the block
            await Promise.all(this.saveGenericPromises);

            await vmManager.terminateBlock();

            return true;
        } catch (e) {
            const error: Error = e as Error;
            this.error(
                `[FinalizeBlock] Something went wrong while executing the block: ${Config.DEV_MODE ? error.stack : error.message}`,
            );

            try {
                await this.revertBlock(vmManager);
            } catch {}

            return false;
        }
    }

    public async revertBlock(vmManager: VMManager): Promise<void> {
        this._reverted = true;

        await vmManager.revertBlock();
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
        if (!states) {
            throw new Error('Block have no states');
        }

        const storageTree = states.storage;
        if (!storageTree) {
            throw new Error('Storage tree not found');
        }

        // We must verify if we're only storing one pointer, if it crashes.
        if (storageTree.size()) {
            const proofs = storageTree.getProofs();
            this.#_storageRoot = storageTree.root;
            this.#_storageProofs = proofs;
        } else {
            this.#_storageRoot = ZERO_HASH;
            this.#_storageProofs = new Map();
        }

        this.verifyIfBlockAborted();

        const proofsReceipt = states.receipts.getProofs();
        this.#_receiptRoot = states.receipts.root;
        this.#_receiptProofs = proofsReceipt;

        await this.signBlock(vmManager);
    }

    /** Transactions Execution */
    protected async executeTransactions(
        vmManager: VMManager,
        specialManager: SpecialManager,
    ): Promise<void> {
        const promises: Promise<void>[] = [
            /*this.executeThreadedGenericTransactions(
                this.genericTransactions,
                vmManager,
                specialManager,
            ),*/
            this.executeOPNetTransactions(this.opnetTransactions, vmManager, specialManager),
        ];

        await Promise.all(promises);
    }

    /** We execute interaction transactions with this method */
    protected async executeInteractionTransaction(
        transaction: InteractionTransaction | WrapTransaction,
        vmManager: VMManager,
        unlimitedGas: boolean = false,
    ): Promise<void> {
        const start = Date.now();
        try {
            if (!this.isOPNetEnabled()) {
                throw new Error('OPNet is not enabled');
            }

            /** We must create a transaction receipt. */
            transaction.receipt = await vmManager.executeTransaction(
                this.height,
                this.median,
                transaction,
                unlimitedGas,
            );

            if (transaction.receipt.revert) {
                const error =
                    transaction.receipt.revert instanceof Error
                        ? transaction.receipt.revert
                        : new Error(transaction.receipt.revert);

                if (Config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                    if (Config.DEV_MODE) {
                        this.error(
                            `Transaction ${transaction.txid} reverted with reason: ${error}`,
                        );
                    } else {
                        this.error(
                            `Transaction ${transaction.txid} reverted with reason: ${error.message}`,
                        );
                    }
                }

                transaction.revert = error;
            }
        } catch (e) {
            const error: Error = e as Error;

            if (Config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                this.error(
                    `Failed to execute transaction ${transaction.txid} (took ${Date.now() - start}): ${error.message}`,
                );
            }

            transaction.revert = error;

            vmManager.updateBlockValuesFromResult(
                null,
                transaction.contractAddress,
                transaction.txid,
                true,
            );
        }

        assert(
            !(
                transaction.receipt &&
                transaction.receipt.revert &&
                transaction.receipt.deployedContracts.length
            ),
            'Transaction reverted and some contracts were deployed',
        );
    }

    /** We execute deployment transactions with this method */
    protected async executeDeploymentTransaction(
        transaction: DeploymentTransaction,
        vmManager: VMManager,
    ): Promise<void> {
        try {
            if (!this.isOPNetEnabled()) {
                throw new Error('OPNet is not enabled');
            }

            await vmManager.deployContract(this.height, transaction);
        } catch (e) {
            const error: Error = e as Error;
            if (Config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                this.error(`Failed to deploy contract ${transaction.txid}: ${error.message}`);
            }

            transaction.revert = error;

            vmManager.updateBlockValuesFromResult(
                null,
                transaction.p2trAddress || 'bc1dead',
                transaction.txid,
                true,
            );
        }
    }

    private defineGeneric(): void {
        const separatedTransactions = this.separateGenericTransactions();
        this.genericTransactions = separatedTransactions.genericTransactions;
        this.opnetTransactions = separatedTransactions.opnetTransactions;
    }

    private isOPNetEnabled(): boolean {
        return (
            Config.OP_NET.ENABLED_AT_BLOCK === 0 ||
            this.height >= BigInt(Config.OP_NET.ENABLED_AT_BLOCK)
        );
    }

    private verifyIfBlockAborted(): void {
        if (this.signal.aborted) {
            throw new Error(`Block #${this.height} aborted for "${this.signal.reason}"`);
        }
    }

    private async executeSpecialTransactions(specialManager: SpecialManager): Promise<void> {
        const promises: Promise<void>[] = [];

        /** Concurrently execute the special transactions */
        for (const transaction of this.specialTransaction) {
            if (!specialManager.requireAdditionalSteps(transaction.transactionType)) {
                throw new Error('Special execution not found');
            }

            promises.push(specialManager.execute(transaction));
        }

        await Promise.all(promises);
    }

    private async executeOPNetTransactions(
        transactions: Transaction<OPNetTransactionTypes>[],
        vmManager: VMManager,
        specialManager: SpecialManager,
    ): Promise<void> {
        for (const transaction of transactions) {
            await this.executeOPNetSingleTransaction(transaction, vmManager, specialManager);
            this.verifyIfBlockAborted();
        }
    }

    private async executeOPNetSingleTransaction(
        transaction: Transaction<OPNetTransactionTypes>,
        vmManager: VMManager,
        specialManager: SpecialManager,
    ): Promise<void> {
        switch (transaction.transactionType) {
            case OPNetTransactionTypes.Interaction: {
                const interactionTransaction = transaction as InteractionTransaction;

                await this.executeInteractionTransaction(interactionTransaction, vmManager);
                break;
            }
            case OPNetTransactionTypes.WrapInteraction: {
                const interactionTransaction = transaction as WrapTransaction;

                await this.executeInteractionTransaction(interactionTransaction, vmManager, true);
                break;
            }
            case OPNetTransactionTypes.UnwrapInteraction: {
                const interactionTransaction = transaction as WrapTransaction;

                await this.executeInteractionTransaction(interactionTransaction, vmManager, true);
                break;
            }
            case OPNetTransactionTypes.Deployment: {
                const deploymentTransaction = transaction as DeploymentTransaction;

                await this.executeDeploymentTransaction(deploymentTransaction, vmManager);
                break;
            }
            case OPNetTransactionTypes.Generic: {
                break;
            }
            default: {
                throw new Error(`Unsupported transaction type: ${transaction.transactionType}`);
            }
        }

        if (
            !transaction.revert &&
            specialManager.requireAdditionalSteps(transaction.transactionType)
        ) {
            this.specialTransaction.push(transaction);
        }
    }

    private assignReceiptProofsToTransactions(): void {
        if (!this.#_receiptProofs) {
            throw new Error('Receipt proofs not found');
        }

        for (const transaction of this.transactions) {
            this.verifyIfBlockAborted();

            if (!OPNetInteractionTypeValues.includes(transaction.transactionType)) {
                continue;
            }

            const interactionTransaction = transaction as InteractionTransaction;
            const contractProofs = this.#_receiptProofs.get(interactionTransaction.contractAddress);

            if (!contractProofs) {
                // Transaction reverted.
                continue;
            }

            const proofs = contractProofs.get(interactionTransaction.transactionId);
            interactionTransaction.setReceiptProofs(proofs);
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

        await this.specialExecutionPromise;
        this.specialTransaction = []; // clear up some memory

        /*const isValid = vmManager.validateBlockChecksum({
            height: DataConverter.toDecimal128(this.height),
            checksumRoot: this.checksumRoot,
            checksumProofs: this.checksumProofs,
            hash: this.hash,
            previousBlockChecksum: this.previousBlockChecksum,
            previousBlockHash: this.previousBlockHash,
            receiptRoot: this.receiptRoot,
            merkleRoot: this.merkleRoot,
            storageRoot: this.storageRoot,
        });

        if (!isValid) {
            throw new Error('Block checksum is invalid');
        }*/

        if (Config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.debug(
                `Block ${this.height} signed successfully. Checksum root: ${this.checksumRoot}. Saving ${this.transactions.length} transactions.`,
            );
        }
    }

    private async saveOPNetTransactions(vmManager: VMManager): Promise<void> {
        if (!this.opnetTransactions.length) {
            return;
        }

        const vmStorage = vmManager.getVMStorage();

        const usedUTXOs: UsedUTXOToDelete[] = [];
        const consolidatedUTXOs: IWBTCUTXODocument[] = [];

        const compromisedTransactions: ICompromisedTransactionDocument[] = [];
        const transactionData: TransactionDocument<OPNetTransactionTypes>[] = [];

        const blockHeightDecimal = DataConverter.toDecimal128(this.height);
        for (const transaction of this.opnetTransactions) {
            if (!transaction.authorizedVaultUsage && transaction.vaultInputs.length) {
                compromisedTransactions.push(transaction.getCompromisedDocument());
            }

            transactionData.push(transaction.toDocument());

            if (transaction.transactionType === OPNetTransactionTypes.UnwrapInteraction) {
                const unwrapTransaction = transaction as UnwrapTransaction;

                usedUTXOs.push(...unwrapTransaction.usedUTXOs);
                if (unwrapTransaction.consolidatedVault) {
                    consolidatedUTXOs.push({
                        ...unwrapTransaction.consolidatedVault,
                        blockId: blockHeightDecimal,

                        spent: false,
                        spentAt: null,
                    });
                }
            }
        }

        let promises: Promise<void>[] = [];
        if (usedUTXOs.length) {
            promises.push(vmStorage.setSpentWBTCUTXOs(usedUTXOs, this.height));
        }

        if (consolidatedUTXOs.length) {
            promises.push(vmStorage.setWBTCUTXOs(consolidatedUTXOs));
        }

        promises.push(vmStorage.deleteOldUTXOs(this.height));
        promises.push(vmStorage.deleteOldUsedUtxos(this.height));

        if (compromisedTransactions.length) {
            this.panic(
                `Found ${compromisedTransactions.length} compromised transactions in block ${this.height}.`,
            );

            this.#compromised = true;

            promises.push(vmStorage.saveCompromisedTransactions(compromisedTransactions));
        }

        promises.push(vmManager.saveTransactions(transactionData));

        await Promise.all(promises);

        if (Config.DEBUG_LEVEL >= DebugLevel.ALL) {
            this.success(`All OPNet transactions of block ${this.height} saved successfully.`);
        }
    }

    private async saveGenericTransactions(vmManager: VMManager): Promise<void> {
        if (!this.genericTransactions.length) {
            return;
        }

        const transactionData: TransactionDocument<OPNetTransactionTypes>[] = [];
        for (const transaction of this.genericTransactions) {
            transactionData.push(transaction.toDocument());
        }

        try {
            await vmManager.saveTransactions(transactionData);
        } catch (e) {
            const error: Error = e as Error;
            this.abortController.abort(`Error saving generic transactions ${error.stack}`);
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

    private separateGenericTransactions(): {
        genericTransactions: Transaction<OPNetTransactionTypes>[];
        opnetTransactions: Transaction<OPNetTransactionTypes>[];
    } {
        const genericTransactions = this.transactions
            .filter((transaction) => transaction.transactionType === OPNetTransactionTypes.Generic)
            .sort((a, b) => a.index - b.index);

        const nonGenericTransactions = this.transactions
            .filter((transaction) => transaction.transactionType !== OPNetTransactionTypes.Generic)
            .sort((a, b) => a.index - b.index);

        return { genericTransactions, opnetTransactions: nonGenericTransactions };
    }

    private createTransactions(): void {
        if (this.transactions.length > 0) {
            throw new Error('Transactions are already created');
        }

        if (!this.rawTransactionData) {
            throw new Error('Raw transaction data not found');
        }

        this.erroredTransactions.clear();

        for (let i = 0; i < this.rawTransactionData.length; i++) {
            const rawTransactionData = this.rawTransactionData[i];

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
                if (Config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                    const error: Error = e as Error;

                    this.error(
                        `Failed to parse transaction ${rawTransactionData.txid}: ${Config.DEV_MODE ? error.stack : error.message}`,
                    );
                }

                this.treatAsGenericTransaction(rawTransactionData);

                this.erroredTransactions.add(rawTransactionData);
            }
        }
    }

    private treatAsGenericTransaction(rawTransactionData: TransactionData): boolean {
        try {
            const genericTransaction = new GenericTransaction(
                rawTransactionData,
                0,
                this.hash,
                this.height,
                this.network,
            );

            genericTransaction.parseTransaction(rawTransactionData.vin, rawTransactionData.vout);

            this.transactions.push(genericTransaction);

            return true;
        } catch (e) {
            this.panic(
                `Failed to parse generic transaction ${rawTransactionData.txid}. This will lead to bad indexing of transactions. Please report this bug.`,
            );
        }

        return false;
    }
}
