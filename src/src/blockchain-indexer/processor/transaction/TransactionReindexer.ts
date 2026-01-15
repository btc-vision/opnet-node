import { Logger } from '@btc-vision/bsi-common';
import { VMStorage } from '../../../vm/storage/VMStorage.js';
import { OPNetTransactionTypes } from './enums/OPNetTransactionTypes.js';
import { TransactionDocument } from '../../../db/interfaces/ITransactionDocument.js';
import { Decimal128 } from 'mongodb';
import crypto from 'crypto';
import { TransactionSorter } from './transaction-sorter/TransactionSorter.js';
import { ISortableTransaction, ISortableTransactionInput } from './transaction-sorter/ISortableTransaction.js';

class SortableDocumentWrapper implements ISortableTransaction {
    public readonly transactionIdString: string;
    public readonly transactionHashString: string;
    public readonly priorityFee: bigint;
    public readonly computedIndexingHash: Buffer;
    public readonly inputs: ISortableTransactionInput[];

    constructor(
        public readonly document: TransactionDocument<OPNetTransactionTypes>,
        blockHash: Buffer,
    ) {
        this.transactionIdString = document.id.toString('hex');
        this.transactionHashString = document.hash.toString('hex');
        this.priorityFee = BigInt(document.priorityFee.toString());

        const hash = crypto.createHash('sha256');
        hash.update(document.hash);
        hash.update(blockHash);
        this.computedIndexingHash = hash.digest();

        this.inputs = document.inputs;
    }
}

export class TransactionReindexer extends Logger {
    public readonly logColor: string = '#00cc99';

    private readonly sorter = new TransactionSorter<SortableDocumentWrapper>();
    private isReindexing: boolean = false;

    constructor(private readonly vmStorage: VMStorage) {
        super();
    }

    public async reindexTransactions(
        fromBlock: bigint,
        currentBlockHeight: bigint,
    ): Promise<boolean> {
        if (this.isReindexing) {
            throw new Error('Transaction reindex already in progress');
        }

        this.isReindexing = true;

        try {
            if (fromBlock > currentBlockHeight) {
                this.warn(
                    `Starting block ${fromBlock} > current block height ${currentBlockHeight}`,
                );
                return true;
            }

            const totalBlocks = currentBlockHeight - fromBlock + 1n;

            this.info(
                `Starting transaction reindex from block ${fromBlock} to ${currentBlockHeight}... (total ${totalBlocks} blocks)`,
            );

            const startTime = Date.now();
            let blocksProcessed = 0n;

            for (let blockHeight = fromBlock; blockHeight <= currentBlockHeight; blockHeight++) {
                const transactions = await this.vmStorage.getTransactionsByBlockHeight(blockHeight);

                if (transactions.length === 0) {
                    blocksProcessed++;
                    continue;
                }

                const blockHeader = await this.vmStorage.getBlockHeader(blockHeight);
                if (!blockHeader) {
                    throw new Error(`Block header not found for height ${blockHeight}`);
                }
                const blockHash = Buffer.from(blockHeader.hash, 'hex');

                this.verifyOnlyGenericTransactions(transactions, blockHeight);

                const wrappers = transactions.map((doc) => new SortableDocumentWrapper(doc, blockHash));
                const sorted = this.sorter.sortTransactions(wrappers);

                const hasChanges = this.detectIndexChanges(wrappers, sorted);

                if (hasChanges) {
                    await this.updateTransactionIndices(sorted);
                }

                blocksProcessed++;

                if (blocksProcessed % 1000n === 0n) {
                    const percent = ((Number(blocksProcessed) / Number(totalBlocks)) * 100).toFixed(1);
                    const elapsed = Date.now() - startTime;
                    const avgPerBlock = blocksProcessed > 0n ? elapsed / Number(blocksProcessed) : 0;
                    const remaining = Number(totalBlocks) - Number(blocksProcessed);
                    const etaMinutes = Math.ceil((avgPerBlock * remaining) / 60000);

                    this.info(
                        `[${percent}%] Reindexing block ${blockHeight}/${currentBlockHeight} ` +
                            `(ETA: ${etaMinutes}min)...`,
                    );
                }
            }

            const totalTime = (Date.now() - startTime) / 1000;
            this.success(`---- TRANSACTION REINDEX COMPLETED ----`);
            this.success(`Total blocks: ${totalBlocks}`);
            this.success(`Took ${totalTime.toFixed(2)}s`);
            this.success(`Avg per block: ${(totalTime / Number(totalBlocks)).toFixed(3)}s`);

            return true;
        } finally {
            this.isReindexing = false;
        }
    }

    private verifyOnlyGenericTransactions(
        transactions: TransactionDocument<OPNetTransactionTypes>[],
        blockHeight: bigint,
    ): void {
        for (const tx of transactions) {
            if (tx.OPNetType !== OPNetTransactionTypes.Generic) {
                throw new Error(
                    `OPNet transaction reindexing not implemented. ` +
                        `Found ${tx.OPNetType} transaction at block ${blockHeight}, ` +
                        `txid: ${tx.id.toString('hex')}`,
                );
            }
        }
    }

    private detectIndexChanges(
        original: SortableDocumentWrapper[],
        sorted: SortableDocumentWrapper[],
    ): boolean {
        if (original.length !== sorted.length) {
            return true;
        }

        for (let i = 0; i < original.length; i++) {
            if (original[i].transactionHashString !== sorted[i].transactionHashString) {
                return true;
            }
        }

        return false;
    }

    private async updateTransactionIndices(sorted: SortableDocumentWrapper[]): Promise<void> {
        const updates: { hash: Buffer; index: number; blockHeight: Decimal128 }[] = [];

        for (let i = 0; i < sorted.length; i++) {
            const wrapper = sorted[i];
            if (wrapper.document.index !== i) {
                updates.push({
                    hash: wrapper.document.hash,
                    index: i,
                    blockHeight: wrapper.document.blockHeight,
                });
            }
        }

        if (updates.length > 0) {
            await this.vmStorage.updateTransactionIndices(updates);
        }
    }
}
