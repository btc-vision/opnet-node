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
import { TransactionData, VOut } from '@btc-vision/bitcoin-rpc/src/rpc/types/BlockData.js';
import { BitcoinRPC } from '@btc-vision/bitcoin-rpc';
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
    public readonly type: TransactionTypes[] = [
        TransactionTypes.BITCOIN_TRANSACTION_V1,
        TransactionTypes.BITCOIN_TRANSACTION_V2,
    ];

    private readonly transactionFactory: TransactionFactory = new TransactionFactory();

    private allowedChallenges: Promise<ChallengeSolution> = Promise.resolve({
        solutions: new AddressMap(),
        legacyPublicKeys: new AddressMap(),
    });

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

    public async onBlockChange(blockHeight: bigint): Promise<void> {
        await this.allowedChallenges; // Don't flood the database on quick block changes

        this.allowedChallenges = this.epochRepository.getChallengeSolutionsAtHeight(blockHeight);
    }

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
