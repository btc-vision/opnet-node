import { ConfigurableDBManager, Logger } from '@btc-vision/bsi-common';
import { ThreadMessageBase } from '../../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadTypes } from '../../../threading/thread/enums/ThreadTypes.js';
import { ThreadData } from '../../../threading/interfaces/ThreadData.js';
import { MessageType } from '../../../threading/enum/MessageType.js';
import { BitcoinRPC, BitcoinVerbosity } from '@btc-vision/bsi-bitcoin-rpc';
import { Config } from '../../../config/Config.js';
import { MempoolRepository } from '../../../db/repositories/MempoolRepository.js';
import { BlockchainInfoRepository } from '../../../db/repositories/BlockchainInfoRepository.js';
import { BitcoinRawTransactionParams } from '@btc-vision/bsi-bitcoin-rpc/src/rpc/types/BitcoinRawTransaction.js';
import { IMempoolTransactionObj } from '../../../db/interfaces/IMempoolTransaction.js';
import { xxHash } from '../../hashing/xxhash.js';
import { OPNetConsensus } from '../../configurations/OPNetConsensus.js';
import { parseAndStoreInputOutputs } from '../../../utils/TransactionMempoolUtils.js';
import fs from 'fs';
import { LargeJSONProcessor } from '../../../utils/LargeJSONProcessor.js';

export class MempoolManager extends Logger {
    public readonly logColor: string = '#00ffe1';

    private readonly bitcoinRPC: BitcoinRPC = new BitcoinRPC();
    private readonly db: ConfigurableDBManager = new ConfigurableDBManager(Config);

    #blockchainInformationRepository: BlockchainInfoRepository | undefined;
    #mempoolRepository: MempoolRepository | undefined;

    private mempoolTransactionCache: Set<string> = new Set();
    private currentBlockHeight: bigint = 0n;
    private startedMainLoop: boolean = false;

    private readonly BACKUP_FOLDER: string = './mempool-backup';
    private readonly BACKUP_FILE: string = 'mempool-backup.json';

    private readonly jsonProcessor: LargeJSONProcessor<string[]> = new LargeJSONProcessor();

    public constructor() {
        super();
    }

    private get mempoolRepository(): MempoolRepository {
        if (!this.#mempoolRepository) throw new Error('Mempool repository not created.');

        return this.#mempoolRepository;
    }

    private get blockchainInformationRepository(): BlockchainInfoRepository {
        if (!this.#blockchainInformationRepository) {
            throw new Error('BlockchainInformationRepository not created.');
        }

        return this.#blockchainInformationRepository;
    }

    public sendMessageToThread: (
        threadType: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ) => Promise<ThreadData | null> = () => {
        throw new Error('sendMessageToThread not implemented.');
    };

    public async handleRequest(m: ThreadMessageBase<MessageType>): Promise<ThreadData> {
        switch (m.type) {
            case MessageType.RPC_METHOD: {
                await new Promise<void>((resolve) => {
                    setTimeout(resolve, 1000);
                });

                return;
            }

            default: {
                throw new Error(
                    `[handleRequest] Unknown message sent by thread of type: ${m.type}`,
                );
            }
        }
    }

    public async init(): Promise<void> {
        this.log(`Starting MempoolManager...`);

        this.db.setup();
        await Promise.all([this.db.connect(), this.bitcoinRPC.init(Config.BLOCKCHAIN)]);

        if (!this.db.db) throw new Error('Database connection not established.');

        this.#mempoolRepository = new MempoolRepository(this.db.db);
        this.#blockchainInformationRepository = new BlockchainInfoRepository(this.db.db);

        await this.watchBlockchain();
    }

    private async watchBlockchain(): Promise<void> {
        this.blockchainInformationRepository.watchBlockChanges(async (blockHeight: bigint) => {
            this.currentBlockHeight = blockHeight;

            try {
                OPNetConsensus.setBlockHeight(blockHeight);
            } catch {}

            if (!this.startedMainLoop) {
                const currentBlockHeight = await this.bitcoinRPC.getBlockHeight();
                if (!currentBlockHeight) {
                    return;
                }

                const blockDiff = BigInt(currentBlockHeight.blockHeight) - blockHeight;
                if (blockDiff >= 10n) {
                    return;
                }

                if (!this.startedMainLoop) {
                    this.warn(`Starting to track mempool transactions...`);

                    this.startedMainLoop = true;
                    this.createMempoolFolderIfNotExists();
                    await this.restoreMempoolBackup();

                    void this.startFetchingMempool();
                }
            }
        });

        await this.blockchainInformationRepository.getCurrentBlockAndTriggerListeners(
            Config.BITCOIN.NETWORK,
        );
    }

    private async startFetchingMempool(): Promise<void> {
        await this.generateMempoolPopulation();

        setTimeout(() => {
            void this.startFetchingMempool();
        }, Config.MEMPOOL.FETCH_INTERVAL);
    }

    private async fetchAllUnknownTransactions(txs: string[]): Promise<IMempoolTransactionObj[]> {
        const txsData = [];

        for (let i = 0; i < txs.length; i += Config.MEMPOOL.BATCH_SIZE) {
            const batch = txs.slice(i, i + Config.MEMPOOL.BATCH_SIZE);

            const promises = batch.map(async (tx) => {
                const params: BitcoinRawTransactionParams = {
                    txId: tx,
                    verbose: BitcoinVerbosity.RAW,
                };

                const txData =
                    await this.bitcoinRPC.getRawTransaction<BitcoinVerbosity.RAW>(params);

                if (!txData) {
                    this.error(`Failed to fetch transaction ${tx}`);
                    return;
                }

                return this.convertTxDataToMempoolTransaction({
                    hex: txData,
                    txid: tx,
                });
            });

            const batchData = await Promise.all(promises);
            txsData.push(...batchData.filter((tx) => !!tx));
        }

        return txsData;
    }

    private convertTxDataToMempoolTransaction(txData: {
        hex: string;
        txid: string;
    }): IMempoolTransactionObj {
        const data = Buffer.from(txData.hex, 'hex');
        const resp: IMempoolTransactionObj = {
            id: txData.txid,
            identifier: xxHash.hash(data),
            psbt: false,
            data: data,
            firstSeen: new Date(),
            blockHeight: this.currentBlockHeight,
            inputs: [],
            outputs: [],
        };

        parseAndStoreInputOutputs(data, resp);

        return resp;
    }

    private createMempoolFolderIfNotExists(): void {
        if (!fs.existsSync(this.BACKUP_FOLDER)) {
            fs.mkdirSync(this.BACKUP_FOLDER);
        }
    }

    private doesBackupFileExist(): boolean {
        return fs.existsSync(`${this.BACKUP_FOLDER}/${this.BACKUP_FILE}`);
    }

    private async generateMempoolBackup(txsList: Array<string>): Promise<void> {
        try {
            if (txsList.length === 0) {
                return;
            }

            const start = Date.now();
            if (txsList.length > 3_000_000) {
                await this.jsonProcessor.stringifyToFile(
                    txsList,
                    `${this.BACKUP_FOLDER}/${this.BACKUP_FILE}`,
                );
            } else {
                fs.writeFileSync(
                    `${this.BACKUP_FOLDER}/${this.BACKUP_FILE}`,
                    JSON.stringify(txsList),
                );
            }

            this.warn(`Generated mempool backup in ${Date.now() - start}ms`);
        } catch (e) {
            this.error(`Failed to generate mempool backup: ${(e as Error).message}`);
        }
    }

    private async restoreMempoolBackup(): Promise<void> {
        try {
            if (!this.doesBackupFileExist()) {
                return;
            }

            const start = Date.now();
            const txs = await this.jsonProcessor.parseFromFile(
                `${this.BACKUP_FOLDER}/${this.BACKUP_FILE}`,
            );

            if (!txs) {
                return;
            }

            this.mempoolTransactionCache = new Set(txs);
            this.warn(`Restored mempool backup in ${Date.now() - start}ms`);
        } catch (e) {
            this.error(`Failed to restore mempool backup: ${(e as Error).message}`);
        }
    }

    private async generateMempoolPopulation(): Promise<void> {
        try {
            const startedAt = Date.now();
            const txsList: string[] | null = await this.bitcoinRPC.getRawMempool(
                BitcoinVerbosity.RAW,
            );

            if (!txsList) {
                this.error('Failed to fetch mempool transactions');
                return;
            }

            const unknownTxs = txsList.filter((tx) => !this.mempoolTransactionCache.has(tx));
            this.mempoolTransactionCache = new Set(txsList);

            if (!unknownTxs.length) {
                return;
            }

            const start = Date.now();
            const alreadyKnownTxs =
                await this.mempoolRepository.getAllTransactionIncluded(unknownTxs);

            const newTxs = unknownTxs.filter((tx) => !alreadyKnownTxs.includes(tx));
            if (!newTxs.length) {
                return;
            }

            await this.generateMempoolBackup(txsList);

            const fetchedTxs = await this.fetchAllUnknownTransactions(newTxs);
            if (!fetchedTxs.length) {
                return;
            }

            const end = Date.now();
            this.log(
                `Found ${txsList.length} tx - ${unknownTxs.length} new tx - ${alreadyKnownTxs.length} already known. (verified db under ${end - start}ms - precomputed under ${end - startedAt}ms)`,
            );

            const stored = Date.now();
            await this.mempoolRepository.storeTransactions(fetchedTxs);

            this.log(`Stored ${fetchedTxs.length} transactions in ${Date.now() - stored}ms`);
        } catch (e) {
            this.error(`Failed to fetch mempool transactions: ${(e as Error).message}`);
        }
    }
}
