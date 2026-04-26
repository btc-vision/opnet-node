import { TransactionVerifier } from '../../TransactionVerifier.js';
import { TransactionTypes } from '../../../transaction/TransactionTypes.js';
import { Network, networks, toHex, Transaction } from '@btc-vision/bitcoin';
import { ConfigurableDBManager } from '@btc-vision/bsi-common';
import {
    InvalidTransaction,
    KnownTransaction,
} from '../../../transaction/TransactionVerifierManager.js';
import { Config } from '../../../../../config/Config.js';
import { TransactionFactory } from '../../../../../blockchain-indexer/processor/transaction/transaction-factory/TransactionFactory.js';
import { IMempoolTransactionObj } from '../../../../../db/interfaces/IMempoolTransaction.js';
import { BitcoinRPC, TransactionData, VOut } from '@btc-vision/bitcoin-rpc';
import { scriptToAddress } from '../../../../../utils/AddressDecoder.js';
import BigNumber from 'bignumber.js';
import { OPNetConsensus } from '../../../../configurations/OPNetConsensus.js';
import { ChallengeSolution } from '../../../../../blockchain-indexer/processor/interfaces/TransactionPreimage.js';
import { AddressMap } from '@btc-vision/transaction';
import { EpochRepository } from '../../../../../db/repositories/EpochRepository.js';
import { OPNetTransactionTypes } from '../../../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { Transaction as OPNetDecodedTransaction } from '../../../../../blockchain-indexer/processor/transaction/Transaction.js';
import { InteractionTransaction } from '../../../../../blockchain-indexer/processor/transaction/transactions/InteractionTransaction.js';
import { DeploymentTransaction } from '../../../../../blockchain-indexer/processor/transaction/transactions/DeploymentTransaction.js';

const EMPTY_BLOCK_HASH = toHex(new Uint8Array(32));

export class BitcoinTransactionVerificatorV2 extends TransactionVerifier<TransactionTypes[]> {
    private static readonly RETRY_BASE_DELAY_MS = 500;
    private static readonly MAX_RETRIES = 5;
    private static readonly ABORT_POLL_INTERVAL_MS = 100;
    public readonly type: TransactionTypes[] = [
        TransactionTypes.BITCOIN_TRANSACTION_V1,
        TransactionTypes.BITCOIN_TRANSACTION_V2,
    ];

    private readonly transactionFactory: TransactionFactory = new TransactionFactory();
    private allowedChallenges: Promise<ChallengeSolution> = Promise.resolve({
        solutions: new AddressMap(),
        legacyPublicKeys: new AddressMap(),
    });

    private blockChangeQueue: Promise<void> = Promise.resolve();
    private targetSolutionsHeight: bigint = -1n;

    public constructor(
        db: ConfigurableDBManager,
        rpc: BitcoinRPC,
        network: Network = networks.bitcoin,
    ) {
        super(db, rpc, network);
    }

    private _epochRepository: EpochRepository | undefined;

    private get epochRepository(): EpochRepository {
        if (!this._epochRepository) {
            throw new Error('EpochRepository not initialized');
        }

        return this._epochRepository;
    }

    public onBlockChange(blockHeight: bigint): Promise<void> {
        // Record the latest requested height synchronously, so any in-flight or
        // queued retries for older heights can detect that a newer block has
        // arrived and abandon themselves.
        this.targetSolutionsHeight = blockHeight;

        const result = this.blockChangeQueue.then(async () => {
            // A newer onBlockChange may have advanced the target while we were
            // queued. Skip this stale slot, the newer callback will run next.
            if (this.targetSolutionsHeight !== blockHeight) {
                return;
            }

            // Always refetch when called. Block height alone is not a safe
            // cache key under chain reorgs: the same height can correspond
            // to different chain states with different challenge solutions.
            // The targetSolutionsHeight check above already collapses bursts
            // of duplicate requests that arrive while a fetch is in progress;
            // sequential same-height calls (e.g. verifyBlockHeight on a 5s
            // tick during a sync gap) will incur one DB query each, which is
            // an acceptable cost for reorg correctness.
            await this.fetchAndApplyChallenges(blockHeight);
        });

        // Keep the internal queue healthy even if all retries are exhausted.
        // The caller still observes the rejection via `result`; this trailing
        // catch only prevents the shared chain from being permanently poisoned.
        this.blockChangeQueue = result.catch((e: unknown) => {
            this.error(
                `Failed to load challenge solutions for block ${blockHeight}: ${(e as Error).stack}`,
            );
        });

        return result;
    }

    /*public async onBlockChange(blockHeight: bigint): Promise<void> {
        await this.allowedChallenges; // Don't flood the database on quick block changes

        this.allowedChallenges = this.epochRepository.getChallengeSolutionsAtHeight(blockHeight);
    }*/

    public createRepositories(): void {
        if (!this.db || !this.db.db) {
            throw new Error('Database not initialized');
        }

        this._epochRepository = new EpochRepository(this.db.db);
    }

    public async verify(
        transaction: IMempoolTransactionObj,
        data: Transaction,
        txData?: TransactionData,
    ): Promise<KnownTransaction | InvalidTransaction> {
        let tx: KnownTransaction | InvalidTransaction;
        try {
            const solutions = await this.allowedChallenges;

            const decoded = !txData ? this.toRawTransactionData(data) : txData;
            const opnetDecodedTransaction = this.transactionFactory.parseTransaction(
                decoded,
                EMPTY_BLOCK_HASH,
                this.currentBlockHeight,
                this.network,
                solutions,
            );

            tx = {
                success: true,
                type: this.getTxVersion(data.version),
                version: OPNetConsensus.consensus.CONSENSUS,
                transaction: opnetDecodedTransaction,
            };

            this.insertSharedProperty(transaction, opnetDecodedTransaction);

            if (opnetDecodedTransaction.transactionType === OPNetTransactionTypes.Interaction) {
                this.insertInteractionProperty(
                    transaction,
                    opnetDecodedTransaction as InteractionTransaction,
                );
            } else if (
                opnetDecodedTransaction.transactionType === OPNetTransactionTypes.Deployment
            ) {
                this.insertDeploymentProperty(
                    transaction,
                    opnetDecodedTransaction as DeploymentTransaction,
                );
            }
        } catch (e) {
            const error = (e as Error).message;
            if (Config.DEV_MODE) {
                this.error(`Error verifying Bitcoin Transaction V2: ${error}`);
            }

            tx = {
                success: false,
                error: error,
            };
        }

        return tx;
    }

    protected getTxVersion(version: number): TransactionTypes {
        return version === 2
            ? TransactionTypes.BITCOIN_TRANSACTION_V2
            : TransactionTypes.BITCOIN_TRANSACTION_V1;
    }

    private async fetchAndApplyChallenges(blockHeight: bigint): Promise<void> {
        let lastError: unknown;

        for (let attempt = 0; attempt <= BitcoinTransactionVerificatorV2.MAX_RETRIES; attempt++) {
            // Abandon if a newer height has been requested in the meantime.
            if (this.targetSolutionsHeight !== blockHeight) {
                return;
            }

            try {
                const next = await this.epochRepository.getChallengeSolutionsAtHeight(blockHeight);

                // Re-check after to await: the DB query may have taken long
                // enough that a newer block arrived. Don't apply stale data.
                if (this.targetSolutionsHeight !== blockHeight) {
                    return;
                }

                this.allowedChallenges = Promise.resolve(next);
                return;
            } catch (e) {
                lastError = e;

                if (attempt >= BitcoinTransactionVerificatorV2.MAX_RETRIES) {
                    break;
                }

                this.warn(
                    `Attempt ${attempt + 1}/${BitcoinTransactionVerificatorV2.MAX_RETRIES + 1} ` +
                        `to load challenge solutions for block ${blockHeight} failed: ` +
                        `${(e as Error).message}. Retrying...`,
                );

                const delayMs = BitcoinTransactionVerificatorV2.RETRY_BASE_DELAY_MS * 2 ** attempt;
                const stillCurrent = await this.abortableSleep(delayMs, blockHeight);
                if (!stillCurrent) {
                    // Target advanced during backoff, abandon this stale retry.
                    return;
                }
            }
        }

        // All retries exhausted. Throw so the queue's trailing .catch logs it.
        // The queue stays healthy, and the next onBlockChange call (or the 5s verifyBlockHeight tick)
        // will re-trigger a fresh attempt.
        throw lastError instanceof Error
            ? lastError
            : new Error(`Failed to fetch challenge solutions for block ${blockHeight}`);
    }

    /**
     * Sleeps up to `ms` ms, waking early if the target block height changes.
     * Returns false if the wait was aborted (caller should abandon work).
     */
    private async abortableSleep(ms: number, blockHeight: bigint): Promise<boolean> {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
            if (this.targetSolutionsHeight !== blockHeight) {
                return false;
            }
            const remaining = deadline - Date.now();
            const chunk = Math.min(
                BitcoinTransactionVerificatorV2.ABORT_POLL_INTERVAL_MS,
                remaining,
            );
            if (chunk <= 0) break;
            await new Promise((r) => setTimeout(r, chunk));
        }
        return this.targetSolutionsHeight === blockHeight;
    }

    private insertSharedProperty(
        transaction: IMempoolTransactionObj,
        decoded: OPNetDecodedTransaction<OPNetTransactionTypes>,
    ): void {
        transaction.transactionType = decoded.transactionType;
        transaction.theoreticalGasLimit = decoded.gasSatFee;
        transaction.priorityFee = decoded.priorityFee;

        try {
            transaction.from = decoded.from.p2tr(this.network);
        } catch {
            // from may not be set for all transaction types
        }
    }

    private insertInteractionProperty(
        transaction: IMempoolTransactionObj,
        decoded: InteractionTransaction,
    ): void {
        try {
            transaction.contractAddress = decoded.contractAddress;
        } catch {
            // contractAddress may not be set
        }

        transaction.calldata = toHex(decoded.calldata);
    }

    private insertDeploymentProperty(
        transaction: IMempoolTransactionObj,
        decoded: DeploymentTransaction,
    ): void {
        try {
            transaction.contractAddress = decoded.contractAddress;
        } catch {
            // contractAddress may not be set
        }

        transaction.calldata = toHex(decoded.calldata);

        if (decoded.bytecode) {
            transaction.bytecode = toHex(decoded.bytecode);
        }
    }

    private toRawTransactionData(data: Transaction): TransactionData {
        const outputs: VOut[] = [];
        for (let i = 0; i < data.outs.length; i++) {
            const output = data.outs[i];

            const decoded = scriptToAddress(output.script, this.network);
            outputs.push({
                value: new BigNumber(Number(output.value)).div(1e8).toNumber(),
                scriptPubKey: {
                    hex: toHex(output.script),
                    address: decoded.address,
                    type: decoded.type,
                },
                n: i,
            });
        }

        return {
            txid: data.getId(),
            version: data.version,
            locktime: data.locktime,
            vin: data.ins.map((input) => ({
                txid: toHex(input.hash),
                vout: input.index,
                scriptSig: {
                    asm: '',
                    hex: toHex(input.script),
                },
                sequence: input.sequence,
                txinwitness: input.witness.map((witness) => toHex(witness)),
            })),
            vout: outputs,
            in_active_chain: false,
            hex: toHex(data.toBuffer()),
            hash: toHex(data.getHash(true)),
            size: data.byteLength(),
            vsize: data.virtualSize(),
            weight: data.weight(),
            blockhash: EMPTY_BLOCK_HASH,
            confirmations: 0,
            blocktime: 0,
            time: 0,
        };
    }
}
