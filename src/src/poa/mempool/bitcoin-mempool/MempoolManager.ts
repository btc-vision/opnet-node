import { ConfigurableDBManager, Logger } from '@btc-vision/bsi-common';
import { ThreadMessageBase } from '../../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadTypes } from '../../../threading/thread/enums/ThreadTypes.js';
import { ThreadData } from '../../../threading/interfaces/ThreadData.js';
import { MessageType } from '../../../threading/enum/MessageType.js';
import {
    BitcoinRPC,
    BitcoinVerbosity,
    TransactionData,
    TransactionDetail,
} from '@btc-vision/bitcoin-rpc';
import { Config } from '../../../config/Config.js';
import { MempoolRepository } from '../../../db/repositories/MempoolRepository.js';
import { BlockchainInfoRepository } from '../../../db/repositories/BlockchainInfoRepository.js';
import { BitcoinRawTransactionParams } from '@btc-vision/bitcoin-rpc/src/rpc/types/BitcoinRawTransaction.js';
import { IMempoolTransactionObj } from '../../../db/interfaces/IMempoolTransaction.js';
import { OPNetConsensus } from '../../configurations/OPNetConsensus.js';
import { parseAndStoreInputOutputs } from '../../../utils/TransactionMempoolUtils.js';
import fs from 'fs';
import { LargeJSONProcessor } from '../../../utils/LargeJSONProcessor.js';
import { RPCMessageData } from '../../../threading/interfaces/thread-messages/messages/api/RPCMessage.js';
import { BitcoinRPCThreadMessageType } from '../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { TransactionVerifierManager } from '../transaction/TransactionVerifierManager.js';
import { Network } from '@btc-vision/bitcoin';
import { NetworkConverter } from '../../../config/network/NetworkConverter.js';

export class MempoolManager extends Logger {
    public readonly logColor: string = '#00ffe1';

    private readonly bitcoinRPC: BitcoinRPC = new BitcoinRPC();
    private readonly db: ConfigurableDBManager = new ConfigurableDBManager(Config);
    private readonly transactionVerifier: TransactionVerifierManager;

    #blockchainInformationRepository: BlockchainInfoRepository | undefined;
    #mempoolRepository: MempoolRepository | undefined;

    private mempoolTransactionCache: Set<string> = new Set();
    private currentBlockHeight: bigint = 0n;
    private startedMainLoop: boolean = false;

    private readonly BACKUP_FOLDER: string = './mempool-backup';
    private readonly BACKUP_FILE: string = 'mempool-backup.json';

    private readonly jsonProcessor: LargeJSONProcessor<string[]> = new LargeJSONProcessor();
    private mempoolLoopCheck: string | number | NodeJS.Timeout | undefined;

    private readonly network: Network = NetworkConverter.getNetwork();

    public constructor() {
        super();

        this.transactionVerifier = new TransactionVerifierManager(
            this.db,
            this.bitcoinRPC,
            this.network,
        );
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
                return this.handleMessage(m.data as RPCMessageData<BitcoinRPCThreadMessageType>);
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
        await Promise.safeAll([this.db.connect(), this.bitcoinRPC.init(Config.BLOCKCHAIN)]);

        if (!this.db.db) throw new Error('Database connection not established.');

        this.#mempoolRepository = new MempoolRepository(this.db.db);
        this.#blockchainInformationRepository = new BlockchainInfoRepository(this.db.db);

        await Promise.safeAll([
            this.watchBlockchain(),
            this.transactionVerifier.createRepositories(),
        ]);
    }

    private handleMessage(_m: RPCMessageData<BitcoinRPCThreadMessageType>): ThreadData {
        return {};
    }

    private async watchBlockchain(): Promise<void> {
        this.blockchainInformationRepository.watchBlockChanges(async (blockHeight: bigint) => {
            this.currentBlockHeight = blockHeight;

            try {
                OPNetConsensus.setBlockHeight(blockHeight);

                await this.transactionVerifier.onBlockChange(blockHeight);
            } catch {}
        });

        this.mempoolLoopCheck = setInterval(async () => {
            if (!this.startedMainLoop) {
                const currentBlockHeight = await this.bitcoinRPC.getBlockHeight();
                if (!currentBlockHeight) {
                    return;
                }

                const blockDiff = BigInt(currentBlockHeight.blockHeight) - this.currentBlockHeight;
                if (blockDiff >= 2n) {
                    return;
                }

                if (!this.startedMainLoop) {
                    this.warn(`Starting to track mempool transactions...`);

                    this.startedMainLoop = true;
                    clearInterval(this.mempoolLoopCheck);

                    this.createMempoolFolderIfNotExists();
                    await this.restoreMempoolBackup();

                    void this.startFetchingMempool();
                }
            } else {
                clearInterval(this.mempoolLoopCheck);
            }
        }, 30000);

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
                    verbose: BitcoinVerbosity.NONE,
                };

                const txData =
                    await this.bitcoinRPC.getRawTransaction<BitcoinVerbosity.NONE>(params);

                if (!txData) {
                    this.error(`Failed to fetch transaction ${tx}`);
                    return;
                }

                return await this.convertTxDataToMempoolTransaction({
                    tx: txData,
                    txid: tx,
                });
            });

            const batchData = await Promise.safeAll(promises);
            txsData.push(...batchData.filter((tx) => !!tx));

            if (Config.DEV_MODE) {
                this.log(
                    `Fetched batch ${Math.floor(i / Config.MEMPOOL.BATCH_SIZE) + 1} of ${Math.ceil(
                        txs.length / Config.MEMPOOL.BATCH_SIZE,
                    )} (${txsData.length} transactions processed so far)`,
                );
            }
        }

        return txsData;
    }

    private async convertTxDataToMempoolTransaction(txData: {
        tx: TransactionDetail;
        txid: string;
    }): Promise<IMempoolTransactionObj> {
        const data = Buffer.from(txData.tx.hex, 'hex');
        const resp: IMempoolTransactionObj = {
            id: txData.txid,
            psbt: false,
            data: data,
            isOPNet: false,
            firstSeen: new Date(),
            blockHeight: this.currentBlockHeight,
            inputs: [],
            outputs: [],
            theoreticalGasLimit: 0n,
            priorityFee: 0n,
        };

        parseAndStoreInputOutputs(data, resp);

        try {
            const decodedTransaction = await this.transactionVerifier.verify(
                resp,
                txData.tx as TransactionData,
            );

            if (!decodedTransaction) {
                this.error(`Failed to verify transaction ${txData.txid}`);
            }
        } catch (e) {
            if (Config.DEV_MODE) {
                this.warn(`Error verifying transaction ${txData.txid}: ${(e as Error).message}`);
            }
        }

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

            if (txsList.length > 10_000_000) {
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
        } catch (e) {
            this.error(`Failed to generate mempool backup: ${(e as Error).message}`);
        }
    }

    private async restoreMempoolBackup(): Promise<void> {
        try {
            if (!this.doesBackupFileExist()) {
                return;
            }

            const txs = await this.jsonProcessor.parseFromFile(
                `${this.BACKUP_FOLDER}/${this.BACKUP_FILE}`,
            );

            if (!txs) {
                return;
            }

            this.mempoolTransactionCache = new Set(txs);
        } catch (e) {
            this.error(`Failed to restore mempool backup: ${(e as Error).message}`);
        }
    }

    private async generateMempoolPopulation(): Promise<void> {
        let txsList: string[] | null = null;
        try {
            const startedAt = Date.now();
            txsList = await this.bitcoinRPC.getRawMempool(BitcoinVerbosity.RAW);

            if (!txsList) {
                this.error('Failed to fetch mempool transactions');
                return;
            }

            const unknownTxs = txsList.filter((tx) => !this.mempoolTransactionCache.has(tx));
            this.mempoolTransactionCache = new Set(txsList);

            if (!unknownTxs.length) {
                await this.cleanUpDB(txsList);
                return;
            }

            const start = Date.now();
            const alreadyKnownTxs =
                await this.mempoolRepository.getAllTransactionIncluded(unknownTxs);

            const newTxs = unknownTxs.filter((tx) => !alreadyKnownTxs.includes(tx));
            if (!newTxs.length) {
                await this.cleanUpDB(txsList);
                return;
            }

            const fetchedTxs = await this.fetchAllUnknownTransactions(newTxs);
            if (!fetchedTxs.length) {
                await this.cleanUpDB(txsList);
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
        } finally {
            if (txsList && txsList.length) {
                await this.generateMempoolBackup(txsList);
                await this.cleanUpDB(txsList);
            }
        }
    }

    private async cleanUpDB(currentTxs: string[]): Promise<void> {
        const dbIds = await this.mempoolRepository.getAllTransactionIds();
        const toDelete = dbIds.filter((id) => !currentTxs.includes(id));

        if (toDelete.length) {
            this.log(`Cleaning up ${toDelete.length} evicted transactions from DB`);
            await this.mempoolRepository.deleteTransactionsById(toDelete);
        }
    }
}
