import { TransactionVerifier } from '../../TransactionVerifier.js';
import { TransactionTypes } from '../../../transaction/TransactionTypes.js';
import { Network, networks, Transaction } from '@btc-vision/bitcoin';
import { ConfigurableDBManager } from '@btc-vision/bsi-common';
import { KnownTransaction } from '../../../transaction/TransactionVerifierManager.js';
import { Config } from '../../../../../config/Config.js';
import { TransactionFactory } from '../../../../../blockchain-indexer/processor/transaction/transaction-factory/TransactionFactory.js';
import { IMempoolTransactionObj } from '../../../../../db/interfaces/IMempoolTransaction.js';
import { TransactionData, VOut } from '@btc-vision/bitcoin-rpc/src/rpc/types/BlockData.js';
import { BitcoinRPC } from '@btc-vision/bitcoin-rpc';
import { scriptToAddress } from '../../../../../utils/AddressDecoder.js';
import BigNumber from 'bignumber.js';
import { OPNetConsensus } from '../../../../configurations/OPNetConsensus.js';
import { OPNetTransactionTypes } from '../../../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { ChallengeSolution } from '../../../../../blockchain-indexer/processor/interfaces/TransactionPreimage.js';
import { AddressMap } from '@btc-vision/transaction';
import { EpochRepository } from '../../../../../db/repositories/EpochRepository.js';

const EMPTY_BLOCK_HASH = Buffer.alloc(32).toString('hex');

export class BitcoinTransactionVerificatorV2 extends TransactionVerifier<TransactionTypes[]> {
    public readonly type: TransactionTypes[] = [
        TransactionTypes.BITCOIN_TRANSACTION_V1,
        TransactionTypes.BITCOIN_TRANSACTION_V2,
    ];

    private readonly transactionFactory: TransactionFactory = new TransactionFactory();

    private allowedChallenges: Promise<ChallengeSolution> = Promise.resolve(new AddressMap());

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
    ): Promise<KnownTransaction | false> {
        let tx: KnownTransaction | false = false;
        try {
            const solutions = await this.allowedChallenges;
            const decoded = !txData ? this.toRawTransactionData(data) : txData;
            const opnetDecodedTransaction = this.transactionFactory.parseTransaction(
                decoded,
                EMPTY_BLOCK_HASH,
                this.currentBlockHeight,
                this.network,
                solutions,
                false,
            );

            tx = {
                type: this.getTxVersion(data.version),
                version: OPNetConsensus.consensus.CONSENSUS,
                transaction: opnetDecodedTransaction,
            };

            transaction.isOPNet =
                opnetDecodedTransaction.transactionType !== OPNetTransactionTypes.Generic;
            transaction.theoreticalGasLimit = opnetDecodedTransaction.gasSatFee;
            transaction.priorityFee = opnetDecodedTransaction.priorityFee;
        } catch (e) {
            if (Config.DEV_MODE) {
                this.error(`Error verifying Bitcoin Transaction V2: ${(e as Error).message}`);
            }
        }

        return tx;
    }

    protected getTxVersion(version: number): TransactionTypes {
        return version === 2
            ? TransactionTypes.BITCOIN_TRANSACTION_V2
            : TransactionTypes.BITCOIN_TRANSACTION_V1;
    }

    private toRawTransactionData(data: Transaction): TransactionData {
        const outputs: VOut[] = [];
        for (let i = 0; i < data.outs.length; i++) {
            const output = data.outs[i];

            const decoded = scriptToAddress(output.script, this.network);
            outputs.push({
                value: new BigNumber(output.value).div(1e8).toNumber(),
                scriptPubKey: {
                    hex: output.script.toString('hex'),
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
                txid: input.hash.toString('hex'),
                vout: input.index,
                scriptSig: {
                    asm: '',
                    hex: input.script.toString('hex'),
                },
                sequence: input.sequence,
                txinwitness: input.witness.map((witness) => witness.toString('hex')),
            })),
            vout: outputs,
            in_active_chain: false,
            hex: data.toBuffer().toString('hex'),
            hash: data.getHash(true).toString('hex'),
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
