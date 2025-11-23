import { AddressMap } from '@btc-vision/transaction';
import { TransactionData } from '@btc-vision/bitcoin-rpc';
import { DataConverter, DebugLevel, Logger } from '@btc-vision/bsi-common';
import { Network } from '@btc-vision/bitcoin';
import { Config } from '../../../config/Config.js';
import { BlockHeaderChecksumProof, BlockHeaderDocument, } from '../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { ITransactionDocumentBasic, TransactionDocument, } from '../../../db/interfaces/ITransactionDocument.js';
import { EvaluatedStates } from '../../../vm/evaluated/EvaluatedStates.js';
import { VMManager } from '../../../vm/VMManager.js';
import { OPNetInteractionTypeValues, OPNetTransactionTypes, } from '../transaction/enums/OPNetTransactionTypes.js';
import { TransactionFactory } from '../transaction/transaction-factory/TransactionFactory.js';
import { TransactionSorter } from '../transaction/transaction-sorter/TransactionSorter.js';
import { Transaction } from '../transaction/Transaction.js';
import { DeploymentTransaction } from '../transaction/transactions/DeploymentTransaction.js';
import { InteractionTransaction } from '../transaction/transactions/InteractionTransaction.js';
import { BlockDataWithoutTransactionData, BlockHeader } from './classes/BlockHeader.js';
import { ChecksumMerkle } from './merkle/ChecksumMerkle.js';
import { ZERO_HASH } from './types/ZeroValue.js';
import { SpecialManager } from '../special-transaction/SpecialManager.js';
import { GenericTransaction } from '../transaction/transactions/GenericTransaction.js';
import assert from 'node:assert';
import { BlockGasPredictor, CalculatedBlockGas } from '../gas/BlockGasPredictor.js';
import { OPNetConsensus } from '../../../poa/configurations/OPNetConsensus.js';
import { Binary, Long } from 'mongodb';
import { FastStringMap } from '../../../utils/fast/FastStringMap.js';
import { ContractEvaluation } from '../../../vm/runtime/classes/ContractEvaluation.js';
import { RustContract } from '../../../vm/rust/RustContract.js';
import { SharedInteractionParameters } from '../transaction/transactions/SharedInteractionParameters.js';
import { AddressCache, AddressCacheExport } from '../AddressCache.js';
import { ChallengeSolution } from '../interfaces/TransactionPreimage.js';
import { VMStorage } from '../../../vm/storage/VMStorage.js';
import { EpochManager, ValidatedSolutionResult } from '../epoch/EpochManager.js';
import { Submission } from '../transaction/features/Submission.js';
import { PendingTargetEpoch } from '../../../db/documents/interfaces/ITargetEpochDocument.js';
import { IEpochSubmissionsDocument } from '../../../db/documents/interfaces/IEpochSubmissionsDocument.js';

export interface RawBlockParam {
    header: BlockDataWithoutTransactionData;
    abortController: AbortController;
    network: Network;

    allowedSolutions?: ChallengeSolution;

    readonly processEverythingAsGeneric?: boolean;
}

export interface DeserializedBlock extends Omit<RawBlockParam, 'abortController' | 'network'> {
    readonly rawTransactionData: TransactionData[];
    readonly transactionOrder?: string[];

    readonly abortController?: AbortController;
    readonly network?: Network;

    readonly addressCache: AddressCacheExport;
}

class BlockLogger extends Logger {}

const sharedBlockLogger = new BlockLogger();

export class Block {
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

    #_storageRoot: string | undefined;
    #_receiptRoot: string | undefined;
    #_receiptProofs: AddressMap<FastStringMap<string[]>> | undefined;
    #_checksumMerkle: ChecksumMerkle = new ChecksumMerkle();
    #_checksumProofs: BlockHeaderChecksumProof | undefined;
    #_previousBlockChecksum: string | undefined;

    private saveGenericPromises: Promise<void>[] = [];
    private _predictedGas: CalculatedBlockGas | undefined;
    private blockUsedGas: bigint = 0n;

    private readonly processEverythingAsGeneric: boolean = false;
    private readonly _blockHashBuffer: Buffer;
    private readonly addressCache: AddressCache;

    private epochSubmissions: Map<
        string,
        {
            submission: Submission;
            validationResult: ValidatedSolutionResult | null;
            transactionId: string;
            txHash: string;
        }
    > = new Map();

    private transactionOrder: string[] | undefined;

    constructor(params: RawBlockParam | DeserializedBlock) {
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
        this._blockHashBuffer = Buffer.from(this.header.hash, 'hex');

        this._allowedSolutions = params.allowedSolutions;

        this.processEverythingAsGeneric = params.processEverythingAsGeneric || false;

        if ('rawTransactionData' in params) {
            this.transactionOrder = params.transactionOrder;
            this.addressCache = AddressCache.from(params.addressCache || new Map<string, string>());

            this.setRawTransactionData(params.rawTransactionData);
        } else {
            this.addressCache = new AddressCache();
        }
    }

    public get gasUsed(): bigint {
        return this.blockUsedGas;
    }

    public get ema(): bigint {
        if (!this._predictedGas) {
            throw new Error('Predicted gas not found');
        }

        return this._predictedGas.ema;
    }

    public get baseGas(): bigint {
        if (!this._predictedGas) {
            throw new Error('Predicted gas not found');
        }

        return this._predictedGas.bNext;
    }

    private _reverted: boolean = false;

    public get reverted(): boolean {
        return this._reverted;
    }

    /** Block Getters */
    public get hash(): string {
        return this.header.hash;
    }

    public get blockHashBuffer(): Buffer {
        return this._blockHashBuffer;
    }

    public get height(): bigint {
        return this.header.height;
    }

    public get median(): bigint {
        return BigInt(this.header.medianTime.getTime());
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

    public get storageRoot(): string {
        if (!this.#_storageRoot) {
            throw new Error('Storage root not found');
        }

        return this.#_storageRoot;
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

    protected _allowedSolutions?: ChallengeSolution;

    private get allowedSolutions(): ChallengeSolution {
        if (!this._allowedSolutions) {
            throw new Error('Allowed solutions are mandatory for deserialization.');
        }

        return this._allowedSolutions;
    }

    private _prevEMA: bigint = 0n;

    private get prevEMA(): bigint {
        return this._prevEMA;
    }

    private _prevBaseGas: bigint = 0n;

    private get prevBaseGas(): bigint {
        return (
            this._prevBaseGas ||
            BigInt(
                OPNetConsensus.consensus.GAS.MIN_BASE_GAS * Number(BlockGasPredictor.scalingFactor),
            )
        );
    }

    private _blockGasPredictor: BlockGasPredictor | undefined;

    private get blockGasPredictor(): BlockGasPredictor {
        if (!this._blockGasPredictor) {
            throw new Error('Block gas predictor not found');
        }

        return this._blockGasPredictor;
    }

    public setChallengeSolutions(solutions: ChallengeSolution): void {
        if (this._allowedSolutions) {
            throw new Error('Allowed solutions already set');
        }

        this._allowedSolutions = solutions;
    }

    public getAddressCache(): AddressCacheExport {
        return this.addressCache.export();
    }

    public prepare(): void {
        if (this.processed) {
            throw new Error('Block already processed');
        }

        this.deserialize(true, this.transactionOrder);
        this.transactionOrder = [];

        this.processed = true;
    }

    /*public static fromTransfer(dto: BlockTransferShape, network: Network): Block {
        const abortController = new AbortController();
        if (dto.aborted) abortController.abort(dto.abortReason);

        const reconstructed = new Block({
            header: dto.header,
            abortController,
            network: network,
            allowedPreimages: dto.allowedPreimages.map((ab) => Buffer.from(ab)),
            processEverythingAsGeneric: dto.processEverythingAsGeneric,
        });

        if (dto.rawTransactionData) {
            reconstructed.setRawTransactionData(dto.rawTransactionData);
            reconstructed.transactionOrder = dto.transactionOrder;
        }

        return reconstructed;
    }*/

    public setRawTransactionData(rawTransactionData: TransactionData[]): void {
        this.rawTransactionData = rawTransactionData;

        if (!this.header.nTx) {
            this.header.nTx = rawTransactionData.length;
        }
    }

    public getBlockHeaderDocument(): BlockHeaderDocument {
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

            ema: Number(this.ema),
            baseGas: Number(this.baseGas),
            gasUsed: Long.fromBigInt(this.gasUsed),
        };
    }

    /** Block Processing */
    public deserialize(orderTransactions: boolean, transactionOrder?: string[]): void {
        this.ensureNotProcessed();

        // First, we have to create transaction object corresponding to the transactions types in the block
        this.createTransactions();

        if (orderTransactions) {
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
        }

        this.defineGeneric();
    }

    /** Get all transactions hashes of this block */
    public getTransactionsHashes(): string[] {
        return this.transactions.map((transaction: Transaction<OPNetTransactionTypes>) => {
            return transaction.transactionIdString;
        });
    }

    /*public toTransfer(): BlockTransferTuple {
        const transferList: Transferable[] = [
            //this._blockHashBuffer.buffer,
            ...this.allowedPreimages.map((b) => b.buffer),
        ];

        const dto: BlockTransferShape = {
            header: this.header.toJSON(),
            rawTransactionData: this.rawTransactionData,
            transactionOrder: this.transactionOrder,
            allowedPreimages: [], //this.allowedPreimages.map((b) => b.buffer),
            processEverythingAsGeneric: this.processEverythingAsGeneric,
            aborted: this.signal.aborted,
            abortReason: this.signal.reason as unknown,
        };

        return [dto, transferList];
    }*/

    public getTransactions(): Transaction<OPNetTransactionTypes>[] {
        return this.transactions;
    }

    public getUTXOs(): ITransactionDocumentBasic<OPNetTransactionTypes>[] {
        return this.transactions.map((t) => t.toBitcoinDocument());
    }

    public insertPartialTransactions(vmManager: VMManager): void {
        // temporary
        this.saveGenericPromises.push(this.saveGenericTransactions(vmManager));

        /*if (!Config.INDEXER.DISABLE_UTXO_INDEXING) {
            this.saveGenericPromises.push(
                vmManager.insertUTXOs(
                    this.height,
                    this.transactions.map((t) => t.toBitcoinDocument()),
                ),
            );
        }*/
    }

    /** Block Execution */
    public async execute(vmManager: VMManager, specialManager: SpecialManager): Promise<void> {
        // Free up some memory, we don't need the raw transaction data anymore
        this.rawTransactionData = [];

        this.ensureNotExecuted();

        const timeBeforeExecution = Date.now();

        /** We must fetch the previous block checksum */
        const previousBlockHeaders: BlockHeaderDocument | null | undefined =
            await vmManager.blockHeaderValidator.getBlockHeader(this.height - 1n);

        // Calculate next block base gas
        this.setGasParameters(previousBlockHeaders || null);

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
        this.timeForGenericTransactions = timeAfterGenericTransactions - timeAfterBlockProcessing;

        // We must process opnet transactions
        this.saveGenericPromises.push(this.saveOPNetTransactions(vmManager));
    }

    public async finalizeBlock(vmManager: VMManager): Promise<boolean> {
        try {
            this.verifyIfBlockAborted();

            // We must wait for the generic transactions to be saved before finalizing the block
            await Promise.safeAll(this.saveGenericPromises);
            await vmManager.saveBlock(this);
            await vmManager.terminateBlock();

            return true;
        } catch (e) {
            const error: Error = e as Error;
            sharedBlockLogger.error(
                `[FinalizeBlock] Something went wrong while executing the block: ${Config.DEV_MODE ? error.stack : error.message}`,
            );

            try {
                await this.revertBlock(vmManager);
            } catch {}

            return false;
        }
    }

    public async revertBlock(vmManager: VMManager): Promise<void> {
        await Promise.safeAll(this.saveGenericPromises);

        if (this.specialExecutionPromise) {
            await this.specialExecutionPromise;
        }

        this._reverted = true;
        await vmManager.revertBlock();
    }

    public verifyIfBlockAborted(): void {
        if (this.signal.aborted) {
            throw new Error(`Block #${this.height} aborted for "${this.signal.reason}"`);
        }
    }

    public async onEmptyBlock(vmManager: VMManager): Promise<void> {
        this.#_storageRoot = ZERO_HASH;
        this.#_receiptRoot = ZERO_HASH;

        await this.signBlock(vmManager);
    }

    public async processSubmissions(
        vmStorage: VMStorage,
        epochManager: EpochManager,
    ): Promise<void> {
        const currentEpoch = this.height / OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH;

        // Extract and dedupe submissions directly into this.epochSubmissions
        this.extractUniqueSubmissions();

        // Batch check existence and remove existing ones
        await this.filterExistingSubmissions(epochManager, currentEpoch);

        const pendingTarget = await epochManager.getPendingEpochTarget(currentEpoch);

        // Validate submissions synchronously and remove invalid ones
        this.validateSubmissions(epochManager, pendingTarget);

        await this.saveEpochSubmissions(vmStorage);
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
            this.#_storageRoot = storageTree.root;
        } else {
            this.#_storageRoot = ZERO_HASH;
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
        await this.executeOPNetTransactions(this.opnetTransactions, vmManager, specialManager);
    }

    /** We execute interaction transactions with this method */
    protected async executeInteractionTransaction(
        transaction: InteractionTransaction,
        vmManager: VMManager,
        isSimulation: boolean = false,
    ): Promise<void> {
        const start = Date.now();
        try {
            this.checkConstraintsBlock(transaction);

            // Verify that tx is not coinbase.
            if (!transaction.inputs[0]?.originalTransactionId) {
                throw new Error('Coinbase transactions are not allowed');
            }

            /** We must create a transaction receipt. */
            const evaluation = await vmManager.executeTransaction(
                this.blockHashBuffer,
                this.height,
                this.median,
                this.prevBaseGas,
                transaction,
                isSimulation,
            );

            this.blockUsedGas += evaluation.totalGasUsed;

            transaction.receipt = evaluation.getEvaluationResult();

            this.processRevertedTx(transaction);

            if (Config.DEV.DEBUG_VALID_TRANSACTIONS) {
                sharedBlockLogger.debug(
                    `Executed transaction ${transaction.txidHex} for contract ${transaction.contractAddress}. (Took ${Date.now() - start}ms to execute, ${transaction.totalGasUsed} gas used)`,
                );
            }

            this.processEvaluation(evaluation, vmManager);
        } catch (e) {
            this.processTransactionFailure(transaction, e as Error, start, vmManager);
        }

        this.verifyTransaction(transaction);
    }

    /** We execute deployment transactions with this method */
    protected async executeDeploymentTransaction(
        transaction: DeploymentTransaction,
        vmManager: VMManager,
    ): Promise<void> {
        const start = Date.now();
        try {
            this.checkConstraintsBlock(transaction);

            if (!transaction.inputs[0]?.originalTransactionId) {
                throw new Error('Coinbase transactions are not allowed');
            }

            /** We must create a transaction receipt. */
            const evaluation = await vmManager.deployContract(
                this.blockHashBuffer,
                this.height,
                this.median,
                this.prevBaseGas,
                transaction,
            );

            this.blockUsedGas += evaluation.totalGasUsed;
            transaction.receipt = evaluation.getEvaluationResult();

            this.processRevertedTx(transaction);

            if (Config.DEV.DEBUG_VALID_TRANSACTIONS) {
                sharedBlockLogger.debug(
                    `Executed transaction (deployment) ${transaction.txidHex} for contract ${transaction.contractAddress}. (Took ${Date.now() - start}ms to execute, ${evaluation.totalGasUsed} gas used)`,
                );
            }

            this.processEvaluation(evaluation, vmManager);
        } catch (e) {
            this.processTransactionFailure(transaction, e as Error, start, vmManager);
        }

        this.verifyTransaction(transaction);
    }

    private extractUniqueSubmissions(): void {
        for (const transaction of this.transactions) {
            if (!transaction.submission) {
                continue;
            }

            const submissionData = transaction.submission;
            const key = this.generateSubmissionKey(submissionData);

            // Skip if already processed
            if (this.epochSubmissions.has(key)) {
                if (Config.DEBUG_LEVEL >= DebugLevel.TRACE) {
                    sharedBlockLogger.debug(
                        `Skipping duplicate epoch submission in tx ${transaction.transactionIdString} (salt+pubkey already seen)`,
                    );
                }
                continue;
            }

            this.epochSubmissions.set(key, {
                submission: submissionData,
                validationResult: null,
                transactionId: transaction.transactionIdString,
                txHash: transaction.hash.toString('hex'),
            });
        }
    }

    private async filterExistingSubmissions(
        epochManager: EpochManager,
        currentEpoch: bigint,
    ): Promise<void> {
        const existenceChecks = Array.from(this.epochSubmissions.entries()).map(([key, data]) => ({
            key,
            promise: epochManager.submissionExists(
                currentEpoch,
                data.submission.salt,
                data.submission.publicKey,
            ),
        }));

        try {
            const results = await Promise.safeAll(existenceChecks.map((check) => check.promise));

            // Remove existing submissions
            for (let i = 0; i < results.length; i++) {
                const exists = results[i];
                const { key } = existenceChecks[i];

                if (exists) {
                    if (Config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                        const data = this.epochSubmissions.get(key);
                        sharedBlockLogger.debug(
                            `Epoch submission in tx ${data?.transactionId} already exists in database`,
                        );
                    }

                    this.epochSubmissions.delete(key);
                }
            }
        } catch (error) {
            if (Config.DEBUG_LEVEL >= DebugLevel.ERROR) {
                sharedBlockLogger.error(`Failed to check existence for submissions: ${error}`);
            }
            // Clear all submissions on error to be safe
            this.epochSubmissions.clear();
        }
    }

    private validateSubmissions(
        epochManager: EpochManager,
        pendingTarget: PendingTargetEpoch,
    ): void {
        const keysToRemove: string[] = [];

        for (const [key, data] of this.epochSubmissions) {
            const validationResult: ValidatedSolutionResult = epochManager.validateEpochSubmission(
                data.submission,
                this.height,
                pendingTarget,
            );

            if (!validationResult.valid) {
                if (Config.DEBUG_LEVEL >= DebugLevel.WARN) {
                    sharedBlockLogger.warn(`Invalid epoch submission in tx ${data.transactionId}`);
                }

                keysToRemove.push(key);
                continue;
            }

            data.validationResult = validationResult;
        }

        for (const key of keysToRemove) {
            this.epochSubmissions.delete(key);
        }
    }

    private generateSubmissionKey(submission: Submission): string {
        return `${submission.salt.toString('hex')}-${submission.publicKey.toString('hex')}`;
    }

    private async saveEpochSubmissions(vmStorage: VMStorage): Promise<void> {
        if (this.epochSubmissions.size === 0) {
            return;
        }

        const currentEpoch = this.height / OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH;
        const submissions: IEpochSubmissionsDocument[] = [];

        for (const data of this.epochSubmissions.values()) {
            if (!data.validationResult || !data.validationResult.valid) {
                continue;
            }

            const submission = data.submission;
            const validationResult = data.validationResult;

            const epochSubmissionDoc: IEpochSubmissionsDocument = {
                confirmedAt: DataConverter.toDecimal128(this.height),
                epochNumber: DataConverter.toDecimal128(currentEpoch),
                startBlock: DataConverter.toDecimal128(
                    currentEpoch * OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH,
                ),

                submissionTxId: new Binary(Buffer.from(data.transactionId, 'hex')),
                submissionTxHash: new Binary(Buffer.from(data.txHash, 'hex')),

                submissionHash: new Binary(validationResult.hash),

                epochProposed: {
                    solution: new Binary(validationResult.hash),
                    publicKey: new Binary(submission.publicKey),
                    salt: new Binary(submission.salt),
                    graffiti: submission.graffiti ? new Binary(submission.graffiti) : undefined,
                },
            };

            submissions.push(epochSubmissionDoc);

            if (Config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                sharedBlockLogger.debug(
                    `Saving epoch submission for tx ${data.transactionId} with ${validationResult.matchingBits} matching bits`,
                );
            }
        }

        if (submissions.length > 0) {
            try {
                // Save all submissions in parallel
                const savePromises = submissions.map((submission) =>
                    vmStorage.saveSubmission(submission),
                );

                await Promise.safeAll(savePromises);

                if (Config.DEV_MODE) {
                    sharedBlockLogger.debugBright(
                        `Saved ${submissions.length} epoch submissions for epoch ${currentEpoch} at block ${this.height}`,
                    );
                }
            } catch (error) {
                sharedBlockLogger.error(`Failed to save epoch submissions: ${error}`);
                throw error;
            }
        }

        this.epochSubmissions.clear();
    }

    private processEvaluation(evaluation: ContractEvaluation, vmManager: VMManager): void {
        if (!evaluation.transactionId) {
            return;
        }

        vmManager.updateBlockValuesFromResult(
            evaluation,
            evaluation.contractAddress,
            evaluation.transactionId.toString('hex'),
            Config.OP_NET.DISABLE_SCANNED_BLOCK_STORAGE_CHECK,
        );
    }

    private verifyTransaction(transaction: Transaction<OPNetTransactionTypes>): void {
        assert(
            !(
                transaction.receipt &&
                transaction.receipt.revert &&
                transaction.receipt.deployedContracts.length
            ),
            'Transaction reverted and some contracts were deployed',
        );
    }

    private processTransactionFailure(
        transaction: InteractionTransaction | DeploymentTransaction,
        error: Error,
        start: number,
        vmManager: VMManager,
    ): void {
        this.blockUsedGas += OPNetConsensus.consensus.GAS.PANIC_GAS_COST;

        if (Config.DEV.DEBUG_TRANSACTION_FAILURE) {
            sharedBlockLogger.error(
                `Failed to execute transaction ${transaction.txidHex} (took ${Date.now() - start}): ${error.message} - (gas: ${transaction.totalGasUsed})`,
            );
        }

        transaction.revert = RustContract.getErrorAsBuffer(error);

        vmManager.updateBlockValuesFromResult(
            null,
            transaction.address,
            transaction.transactionIdString,
            true,
        );
    }

    private checkConstraintsBlock(
        transaction: SharedInteractionParameters<OPNetTransactionTypes>,
    ): void {
        if (!this.isOPNetEnabled()) {
            throw new Error('OPNet is not enabled');
        }

        if (transaction.specialSettings && transaction.specialSettings.bypassBlockLimit) {
            return;
        }

        // Verify if the block is out of gas, this can overflow. This is an expected behavior.
        if (OPNetConsensus.consensus.GAS.MAX_THEORETICAL_GAS < this.blockUsedGas) {
            throw new Error(`Block out of gas`);
        }
    }

    private processRevertedTx(transaction: Transaction<OPNetTransactionTypes>): void {
        if (!(transaction.receipt && transaction.receipt.revert)) {
            return;
        }

        const error = transaction.receipt.revert;
        if (Config.DEV.DEBUG_TRANSACTION_FAILURE) {
            sharedBlockLogger.error(
                `Transaction ${transaction.txidHex} reverted with reason: ${RustContract.decodeRevertData(error).message}`,
            );
        } else if (Config.DEBUG_LEVEL >= DebugLevel.TRACE) {
            sharedBlockLogger.error(`Transaction ${transaction.txidHex} reverted.`);
        }

        transaction.revert = error;
    }

    private defineGeneric(): void {
        const separatedTransactions = this.separateGenericTransactions();
        this.genericTransactions = separatedTransactions.genericTransactions;
        this.opnetTransactions = separatedTransactions.opnetTransactions;
    }

    private isOPNetEnabled(): boolean {
        const opnetEnabledAtBlock = OPNetConsensus.opnetEnabled;

        return opnetEnabledAtBlock.ENABLED && this.height >= opnetEnabledAtBlock.BLOCK;
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

        await Promise.safeAll(promises);
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
            case OPNetTransactionTypes.Deployment: {
                const deploymentTransaction = transaction as DeploymentTransaction;

                await this.executeDeploymentTransaction(deploymentTransaction, vmManager);
                try {
                    await vmManager
                        .getVMStorage()
                        .addTweakedPublicKey(deploymentTransaction.contractTweakedPublicKey);
                } catch (e) {
                    sharedBlockLogger.warn(
                        `Failed to add tweaked public key for contract ${deploymentTransaction.contractAddress}: ${e}`,
                    );
                }

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
            return;
        }

        for (const transaction of this.transactions) {
            this.verifyIfBlockAborted();

            if (!OPNetInteractionTypeValues.includes(transaction.transactionType)) {
                continue;
            }

            const interactionTransaction = transaction as
                | InteractionTransaction
                | DeploymentTransaction;

            const contractProofs = this.#_receiptProofs.get(interactionTransaction.address);
            if (!contractProofs) {
                // Transaction reverted.
                continue;
            }

            const proofs = contractProofs.get(interactionTransaction.transactionIdString);
            interactionTransaction.setReceiptProofs(proofs);
        }
    }

    private setGasParameters(previousBlockHeaders: BlockHeaderDocument | null): void {
        if (previousBlockHeaders !== null) {
            this._prevEMA = BigInt(previousBlockHeaders.ema || 0);
            this._prevBaseGas = BigInt(previousBlockHeaders.baseGas || 0);
        }
    }

    private calculateNextBlockBaseGas(): void {
        if (this._blockGasPredictor) throw new Error('Duplicate block gas predictor');

        this._blockGasPredictor = new BlockGasPredictor(
            OPNetConsensus.consensus.GAS.MIN_BASE_GAS,
            this.prevBaseGas,
            OPNetConsensus.consensus.GAS.TARGET_GAS,
            OPNetConsensus.consensus.GAS.SMOOTH_OUT_GAS_INCREASE,
            OPNetConsensus.consensus.GAS.SMOOTHING_FACTOR,
            OPNetConsensus.consensus.GAS.ALPHA1,
            OPNetConsensus.consensus.GAS.ALPHA2,
            OPNetConsensus.consensus.GAS.U_TARGET,
        );

        if (Config.DEV.SIMULATE_HIGH_GAS_USAGE) {
            this.blockUsedGas += OPNetConsensus.consensus.GAS.TARGET_GAS - 1_000_000n;
        }

        this._predictedGas = this.blockGasPredictor.calculateNextBaseGas(
            this.blockUsedGas,
            this.prevEMA,
        );
    }

    private async signBlock(vmManager: VMManager): Promise<void> {
        this.assignReceiptProofsToTransactions();

        const previousChecksumHeader =
            await vmManager.blockHeaderValidator.getPreviousBlockChecksumOfHeight(this.height);

        if (!previousChecksumHeader) {
            throw new Error(
                `[DATA CORRUPTED] The previous block checksum of block ${this.height} is not found.`,
            );
        }

        this.#_previousBlockChecksum = previousChecksumHeader;

        this.calculateNextBlockBaseGas();

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
    }

    /** TODO: ADD BSON.calculateObjectSize(txDocument); */
    private async saveOPNetTransactions(vmManager: VMManager): Promise<void> {
        if (!this.opnetTransactions.length) {
            return;
        }

        const transactionData: TransactionDocument<OPNetTransactionTypes>[] = [];
        for (const transaction of this.opnetTransactions) {
            const txDocument = transaction.toDocument();

            transactionData.push(txDocument);
        }

        const promises: Promise<void>[] = [];
        promises.push(vmManager.saveTransactions(transactionData));

        await Promise.safeAll(promises);

        if (Config.DEBUG_LEVEL >= DebugLevel.ALL) {
            sharedBlockLogger.success(
                `All OPNet transactions of block ${this.height} saved successfully.`,
            );
        }
    }

    private async saveGenericTransactions(vmManager: VMManager): Promise<void> {
        if (!this.genericTransactions.length) {
            return;
        }

        const transactionData: TransactionDocument<OPNetTransactionTypes>[] = [];
        for (const transaction of this.genericTransactions) {
            const txDocument = transaction.toDocument();

            transactionData.push(txDocument);
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

        if (this.processEverythingAsGeneric) {
            this.rawTransactionData.forEach((tx, idx) => this.treatAsGenericTransaction(tx, idx));
            return;
        }

        for (let i = 0; i < this.rawTransactionData.length; i++) {
            const rawTransactionData = this.rawTransactionData[i];

            if (this.signal.aborted) {
                throw new Error(`Block #${this.height} aborted for "${this.signal.reason}"`);
            }

            this.processTransaction(rawTransactionData, i);
        }
    }

    private processTransaction(rawTransactionData: TransactionData, i: number): void {
        try {
            const transaction = this.transactionFactory.parseTransaction(
                rawTransactionData,
                this.hash,
                this.height,
                this.network,
                this.allowedSolutions,
                true,
                this.addressCache,
            );

            transaction.originalIndex = i;

            this.transactions.push(transaction);
        } catch (e) {
            if (Config.DEV.DEBUG_TRANSACTION_PARSE_FAILURE) {
                const error: Error = e as Error;

                sharedBlockLogger.error(
                    `Failed to parse transaction ${rawTransactionData.txid}: ${Config.DEV_MODE ? error.stack : error.message}`,
                );
            }

            this.treatAsGenericTransaction(rawTransactionData, i);

            this.erroredTransactions.add(rawTransactionData);
        }
    }

    /**
     * Treats a transaction as a generic transaction.
     * @param {TransactionData} rawTransactionData Raw transaction data
     * @param {number} i Index of the original transaction in the block
     * @private
     */
    private treatAsGenericTransaction(rawTransactionData: TransactionData, i: number): boolean {
        try {
            const genericTransaction = new GenericTransaction(
                rawTransactionData,
                0,
                this.hash,
                this.height,
                this.network,
                this.addressCache,
            );

            genericTransaction.originalIndex = i;
            genericTransaction.parseTransaction(rawTransactionData.vin, rawTransactionData.vout);

            this.transactions.push(genericTransaction);

            return true;
        } catch (e) {
            sharedBlockLogger.panic(
                `Failed to parse generic transaction ${rawTransactionData.txid}. This will lead to bad indexing of transactions. Please report this bug.`,
            );
        }

        return false;
    }
}
