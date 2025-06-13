import { TransactionVerifier } from '../../TransactionVerifier.js';
import { TransactionTypes } from '../../../transaction/TransactionTypes.js';
import { Network, networks, Transaction } from '@btc-vision/bitcoin';
import { ConfigurableDBManager } from '@btc-vision/bsi-common';
import { KnownTransaction } from '../../../transaction/TransactionVerifierManager.js';
import { Config } from '../../../../../config/Config.js';
import { TransactionFactory } from '../../../../../blockchain-indexer/processor/transaction/transaction-factory/TransactionFactory.js';
import { BlockRepository } from '../../../../../db/repositories/BlockRepository.js';
import { IMempoolTransactionObj } from '../../../../../db/interfaces/IMempoolTransaction.js';
import { TransactionData, VOut } from '@btc-vision/bitcoin-rpc/src/rpc/types/BlockData.js';
import { BitcoinRPC } from '@btc-vision/bitcoin-rpc';
import { scriptToAddress } from '../../../../../utils/AddressDecoder.js';

const EMPTY_BLOCK_HASH = Buffer.alloc(32).toString('hex');

export class BitcoinTransactionVerificatorV2 extends TransactionVerifier<TransactionTypes.BITCOIN_TRANSACTION_V2> {
    public readonly type: TransactionTypes.BITCOIN_TRANSACTION_V2 =
        TransactionTypes.BITCOIN_TRANSACTION_V2;

    private readonly transactionFactory: TransactionFactory = new TransactionFactory();

    private allowedPreimages: Promise<Buffer[]> = Promise.resolve([]);

    public constructor(
        db: ConfigurableDBManager,
        rpc: BitcoinRPC,
        network: Network = networks.bitcoin,
    ) {
        super(db, rpc, network);
    }

    private _blockRepository: BlockRepository | undefined;

    private get blockRepository(): BlockRepository {
        if (!this._blockRepository) {
            throw new Error('BlockRepository not initialized');
        }

        return this._blockRepository;
    }

    public async onBlockChange(blockHeight: bigint): Promise<void> {
        await this.allowedPreimages; // Don't flood the database on quick block changes

        this.allowedPreimages = this.getPreimages(blockHeight);
    }

    public createRepositories(): void {
        if (!this.db || !this.db.db) {
            throw new Error('Database not initialized');
        }

        this._blockRepository = new BlockRepository(this.db.db);
    }

    public async verify(
        transaction: IMempoolTransactionObj,
        data: Transaction,
    ): Promise<KnownTransaction | false> {
        console.log(`Verifying Bitcoin Transaction V2...`, data);

        const tx: KnownTransaction | false = false;
        try {
            const preimages = await this.allowedPreimages;

            const decoded = this.toRawTransactionData(data);
            console.log(`Decoded transaction:`, decoded);

            const opnetParser = this.transactionFactory.parseTransaction(
                decoded,
                EMPTY_BLOCK_HASH,
                this.currentBlockHeight,
                this.network,
                preimages,
            );

            console.log(`Parsed transaction:`, opnetParser);
        } catch (e) {
            if (Config.DEV_MODE) {
                this.error(`Error verifying Bitcoin Transaction V2: ${(e as Error).message}`);
            }
        } finally {
            // eslint-disable-next-line no-unsafe-finally
            return tx;
        }
    }

    private toRawTransactionData(data: Transaction): TransactionData {
        const outputs: VOut[] = [];
        for (let i = 0; i < data.outs.length; i++) {
            const output = data.outs[i];

            const decoded = scriptToAddress(output.script, this.network);
            outputs.push({
                value: output.value,
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

    private async getPreimages(blockNumber: bigint): Promise<Buffer[]> {
        const hashes = await this.blockRepository.getBlockPreimages(blockNumber);
        if (!hashes.length) {
            return [];
        }

        return hashes.map((hash) => Buffer.from(hash, 'hex'));
    }
}
