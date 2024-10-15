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

export class MempoolManager extends Logger {
    public readonly logColor: string = '#00ffe1';

    private readonly bitcoinRPC: BitcoinRPC = new BitcoinRPC();
    private readonly db: ConfigurableDBManager = new ConfigurableDBManager(Config);

    #blockchainInformationRepository: BlockchainInfoRepository | undefined;
    #mempoolRepository: MempoolRepository | undefined;

    private mempoolTransactionCache: Set<string> = new Set();
    private currentBlockHeight: bigint = 0n;
    private startedMainLoop: boolean = false;

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
                    this.info(`Starting to track mempool transactions...`);

                    this.startedMainLoop = true;
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
        }, 30000);
    }

    private async fetchAllUnknownTransactions(txs: string[]): Promise<IMempoolTransactionObj[]> {
        const batchSize = 50;
        const txsData = [];

        for (let i = 0; i < txs.length; i += batchSize) {
            const batch = txs.slice(i, i + batchSize);

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
