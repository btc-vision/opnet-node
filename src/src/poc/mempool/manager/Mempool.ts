import { ConfigurableDBManager, DebugLevel, Logger } from '@btc-vision/bsi-common';
import { ThreadMessageBase } from '../../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadTypes } from '../../../threading/thread/enums/ThreadTypes.js';
import { ThreadData } from '../../../threading/interfaces/ThreadData.js';
import { MessageType } from '../../../threading/enum/MessageType.js';
import {
    BroadcastRequest,
    BroadcastResponse,
} from '../../../threading/interfaces/thread-messages/messages/api/BroadcastRequest.js';
import {
    RPCMessage,
    RPCMessageData,
} from '../../../threading/interfaces/thread-messages/messages/api/RPCMessage.js';
import { BitcoinRPCThreadMessageType } from '../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { OPNetBroadcastData } from '../../../threading/interfaces/thread-messages/messages/api/BroadcastTransactionOPNet.js';
import {
    InvalidTransaction,
    TransactionVerifierManager,
} from '../transaction/TransactionVerifierManager.js';
import { BitcoinRPC, FeeEstimation, SmartFeeEstimation } from '@btc-vision/bitcoin-rpc';
import { Config } from '../../../config/Config.js';
import { MempoolRepository } from '../../../db/repositories/MempoolRepository.js';
import { NetworkConverter } from '../../../config/network/NetworkConverter.js';
import { Network, toHex } from '@btc-vision/bitcoin';
import { IMempoolTransactionObj } from '../../../db/interfaces/IMempoolTransaction.js';
import { OPNetTransactionTypes } from '../../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { OPNetConsensus } from '../../configurations/OPNetConsensus.js';
import { BlockchainInfoRepository } from '../../../db/repositories/BlockchainInfoRepository.js';
import { TransactionSizeValidator } from '../data-validator/TransactionSizeValidator.js';
import { parseAndStoreInputOutputs } from '../../../utils/TransactionMempoolUtils.js';
import {
    BitcoinFees,
    FeeMessageResponse,
    FeeRecommendation,
} from '../../../threading/interfaces/thread-messages/messages/api/FeeRequest.js';
import { RawMempoolInfo } from '@btc-vision/bitcoin-rpc/src/rpc/types/MempoolInfo.js';
import { getMongodbMajorVersion } from '../../../vm/storage/databases/MongoUtils.js';

const btcPerKvBtoSatPerVByte = (btcPerKvB: number): number => (btcPerKvB * 1e8) / 1_000;

export class Mempool extends Logger {
    public readonly logColor: string = '#00ffe1';

    private readonly bitcoinRPC: BitcoinRPC = new BitcoinRPC();
    private readonly transactionVerifier: TransactionVerifierManager;
    private readonly transactionSizeValidator: TransactionSizeValidator =
        new TransactionSizeValidator();

    private readonly db: ConfigurableDBManager = new ConfigurableDBManager(Config);

    #blockchainInformationRepository: BlockchainInfoRepository | undefined;
    #mempoolRepository: MempoolRepository | undefined;

    private fullSync: boolean = false;

    private readonly network: Network = NetworkConverter.getNetwork();

    private fees: BitcoinFees = {
        conservative: '5',
        recommended: {
            low: '1.5',
            medium: '2.5',
            high: '5',
        },
    };

    constructor() {
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
                return await this.onRPCMethod(
                    m.data as RPCMessageData<BitcoinRPCThreadMessageType>,
                );
            }

            default: {
                throw new Error(
                    `[handleRequest] Unknown message sent by thread of type: ${m.type}`,
                );
            }
        }
    }

    public async init(): Promise<void> {
        this.log(`Starting Mempool...`);

        this.db.setup();
        await Promise.safeAll([this.db.connect(), this.bitcoinRPC.init(Config.BLOCKCHAIN)]);

        if (!this.db.db) throw new Error('Database connection not established.');

        const version = await getMongodbMajorVersion(this.db.db);

        this.#mempoolRepository = new MempoolRepository(this.db.db, version);
        this.#blockchainInformationRepository = new BlockchainInfoRepository(this.db.db);

        await Promise.safeAll([
            this.watchBlockchain(),
            this.estimateFees(),
            this.transactionVerifier.createRepositories(),
        ]);

        await this.verifyBlockHeight();
    }

    private estimateFeesBand(info: RawMempoolInfo): FeeRecommendation {
        const floor = Math.max(
            1,
            Math.round(btcPerKvBtoSatPerVByte(info.mempoolminfee || info.minrelaytxfee || 0.00001)),
        );

        const occ = info.usage / info.maxmempool;
        const txCount = info.size || 0; // Number of transactions

        let low: number, medium: number, high: number;

        // If mempool is essentially empty (< 500 tx and < 5% full)
        if (txCount < 3000 && occ < 0.05) {
            low = floor + 0.5;
            medium = floor + 1;
            high = floor + 2;
        } else if (occ < 0.05 && floor <= 2) {
            low = floor + 1;
            medium = Math.min(5, floor + 2);
            high = Math.min(10, floor + 4);
        } else if (occ < 0.5) {
            low = floor + 2;
            medium = Math.min(10, floor + 5);
            high = Math.min(20, floor + 10);
        } else {
            low = floor + 3;
            medium = Math.max(20, floor + 10);
            high = Math.max(40, floor + 20);
        }

        return {
            low: low.toFixed(4),
            medium: medium.toFixed(4),
            high: high.toFixed(4),
        };
    }

    private async verifyBlockHeight(): Promise<void> {
        try {
            const currentBlockHeight = await this.bitcoinRPC.getBlockHeight();
            if (!currentBlockHeight) {
                return;
            }

            const currentBitcoinHeight: bigint = BigInt(currentBlockHeight.blockHeight) + 1n;
            const blockDiff = currentBitcoinHeight - OPNetConsensus.getBlockHeight();
            if (blockDiff >= 2n) {
                if (Config.DEBUG_LEVEL >= DebugLevel.TRACE) {
                    this.warn(
                        `Block height mismatch: OPNet height ${OPNetConsensus.getBlockHeight()}, Bitcoin Core height ${currentBitcoinHeight}.`,
                    );
                }

                this.fullSync = false;

                await this.onBlockChange(currentBitcoinHeight);
            }

            setTimeout(() => {
                void this.verifyBlockHeight();
            }, 5000);
        } catch (e) {
            if (Config.DEBUG_LEVEL >= DebugLevel.WARN) {
                this.warn(`Error verifying block height: ${(e as Error).message}`);
            }
        }
    }

    private async watchBlockchain(): Promise<void> {
        this.blockchainInformationRepository.watchBlockChanges(async (blockHeight: bigint) => {
            if (OPNetConsensus.getBlockHeight() < blockHeight) {
                await this.onBlockChange(blockHeight);
            }

            const diff = blockHeight - OPNetConsensus.getBlockHeight();
            if (diff === 0n) {
                this.fullSync = true;
            }
        });

        await this.blockchainInformationRepository.getCurrentBlockAndTriggerListeners(
            Config.BITCOIN.NETWORK,
        );
    }

    private async onBlockChange(blockHeight: bigint): Promise<void> {
        try {
            OPNetConsensus.setBlockHeight(blockHeight);

            this.log(`[MEM] Block changed to height ${blockHeight}. Verifying transactions...`);

            await this.transactionVerifier.onBlockChange(blockHeight);

            /*if (Config.MEMPOOL.ENABLE_BLOCK_PURGE) {
                void this.mempoolRepository.purgeOldTransactions(blockHeight);
            }*/

            await this.estimateFees();
        } catch {}
    }

    private processSmartFee(feeData: SmartFeeEstimation): number {
        if ('errors' in feeData && feeData.errors) {
            throw new Error(feeData.errors.join(' '));
        }

        if ('feerate' in feeData) {
            const fee: number = feeData.feerate as number;
            return fee * 100000;
        }

        throw new Error('Invalid fee data received from Bitcoin RPC');
    }

    private async estimateFees(): Promise<void> {
        try {
            const estimatedFee = await Promise.safeAll([
                this.bitcoinRPC.estimateSmartFee(2, FeeEstimation.CONSERVATIVE),
                this.bitcoinRPC.getMempoolInfo(),
            ]);

            const economicalFee = estimatedFee[0];
            const mempoolInfo = estimatedFee[1];

            if (!mempoolInfo) {
                throw new Error('Could not retrieve mempool info from Bitcoin RPC');
            }

            const recommendedFees = this.estimateFeesBand(mempoolInfo);
            const mempoolSize = mempoolInfo.size || 0;
            if (mempoolSize < 3000) {
                this.fees = {
                    conservative: recommendedFees.low,
                    recommended: recommendedFees,
                };
                return;
            }

            this.fees = {
                conservative: this.processSmartFee(economicalFee).toFixed(4),
                recommended: recommendedFees,
            };
        } catch (e) {
            if (Config.DEBUG_LEVEL >= DebugLevel.TRACE) {
                this.error(`Error estimating fees: ${(e as Error).message}`);
            }
        }
    }

    private async onRPCMethod(m: RPCMessageData<BitcoinRPCThreadMessageType>): Promise<ThreadData> {
        switch (m.rpcMethod) {
            case BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET: {
                return await this.onTransactionReceived(m.data as OPNetBroadcastData);
            }

            case BitcoinRPCThreadMessageType.GET_MEMPOOL_FEES: {
                return this.onMempoolFeesRequest();
            }

            default: {
                throw new Error(`Unknown message sent by thread of type: ${m.rpcMethod}`);
            }
        }
    }

    private onMempoolFeesRequest(): FeeMessageResponse {
        return {
            bitcoinFees: this.fees,
        };
    }

    private async onTransactionReceived(data: OPNetBroadcastData): Promise<BroadcastResponse> {
        if (!OPNetConsensus.hasConsensus()) {
            return {
                success: false,
                result: 'Consensus not reached',
            };
        }

        if (Config.MEMPOOL.PREVENT_TX_BROADCAST_IF_NOT_SYNCED) {
            if (!this.fullSync) {
                this.warn(
                    `Transaction broadcast prevented due to node not being fully synchronized.`,
                );

                return {
                    success: false,
                    result: 'This node is still processing the latest block. Transaction broadcasting is temporarily disabled for your safety until full synchronization completes; please reload this page to ensure you’re viewing the most up-to-date chain data before trying again.',
                };
            }
        }

        const raw: Uint8Array = data.raw;
        const psbt: boolean = data.psbt;
        const id = data.id;

        if (psbt) {
            return {
                success: false,
                result: 'PSBT transactions are not supported yet.',
            };
        }

        if (!id) {
            return {
                success: false,
                result: 'No transaction hash provided',
            };
        }

        if (this.transactionSizeValidator.verifyTransactionSize(raw.byteLength, psbt)) {
            return {
                success: false,
                result: 'Transaction too large',
            };
        }

        try {
            const transaction: IMempoolTransactionObj = {
                id: id,
                psbt: psbt,
                transactionType: OPNetTransactionTypes.Generic,
                data: raw,
                firstSeen: new Date(),
                blockHeight: OPNetConsensus.getBlockHeight(),
                inputs: [],
                outputs: [],
            };

            return await this.decodeTransactionAndProcess(transaction);
        } catch (e) {
            if (Config.DEV.DEBUG_API_ERRORS) {
                this.error(`Error processing transaction: ${(e as Error).stack}`);
            }

            return {
                success: false,
                result: `Bad transaction.`,
            };
        }
    }

    private async decodeTransactionAndProcess(
        transaction: IMempoolTransactionObj,
    ): Promise<BroadcastResponse> {
        const exist = await this.mempoolRepository.hasTransactionById(transaction.id);
        if (exist) {
            return {
                success: false,
                result: 'Transaction already in mempool',
            };
        }

        const decodedTransaction = await this.transactionVerifier.verify(transaction);
        if (!decodedTransaction || !decodedTransaction.success) {
            return {
                success: false,
                result: `Could not decode transaction (${(decodedTransaction as InvalidTransaction).error})`,
            };
        }

        const rawHex: string = toHex(transaction.data);
        const broadcast = await this.broadcastBitcoinTransaction(rawHex);

        if (broadcast && broadcast.result) {
            transaction.id = broadcast.result;

            parseAndStoreInputOutputs(transaction.data, transaction);

            const stored = await this.mempoolRepository.storeTransaction(transaction);
            if (!stored) {
                return {
                    success: false,
                    result: 'Could not store transaction in mempool.',
                };
            }

            // Proactively clean up any evicted transactions
            await this.cleanupEvictedTransactions(transaction);
        }

        const response: BroadcastResponse = broadcast || {
            success: false,
            result: 'Could not broadcast transaction to the network.',
        };

        response.transactionType = transaction.transactionType;

        return response;
    }

    private async cleanupEvictedTransactions(transaction: IMempoolTransactionObj): Promise<void> {
        const conflicts = await this.mempoolRepository.findConflictingTransactions(transaction);
        if (!conflicts.length) return;

        const toDelete: Set<string> = new Set();
        const visited: Set<string> = new Set();

        for (const conf of conflicts) {
            toDelete.add(conf.id);
            const descendants = await this.getAllDescendants(conf.id, visited);
            descendants.forEach((id) => toDelete.add(id));
        }

        if (toDelete.size > 100) {
            this.warn(`Evicted transaction count exceeds limit: ${toDelete.size}`);
        }

        await this.mempoolRepository.deleteTransactionsById(Array.from(toDelete));
    }

    private async getAllDescendants(id: string, visited: Set<string>): Promise<string[]> {
        if (visited.has(id)) return [];

        visited.add(id);

        const direct = await this.mempoolRepository.findDirectDescendants(id);
        let all: string[] = [];

        for (const d of direct) {
            const sub = await this.getAllDescendants(d.id, visited);
            all = all.concat([d.id, ...sub]);
        }

        return all;
    }

    private async broadcastBitcoinTransaction(
        data: string,
    ): Promise<BroadcastResponse | undefined> {
        const currentBlockMsg: RPCMessage<BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_BITCOIN_CORE> =
            {
                type: MessageType.RPC_METHOD,
                data: {
                    rpcMethod: BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_BITCOIN_CORE,
                    data: {
                        rawTransaction: data,
                    },
                } as BroadcastRequest,
            };

        try {
            return (await this.sendMessageToThread(ThreadTypes.RPC, currentBlockMsg)) as
                | BroadcastResponse
                | undefined;
        } catch (e: unknown) {
            this.fail(`Error broadcasting transaction to Bitcoin network: ${(e as Error).message}`);

            const err: Error = e as Error;

            return {
                finalizedTransaction: false,
                identifier: 0n,
                peers: 0,
                success: false,
                error: err.message,
            };
        }
    }

    /*private async decodePSBTAndProcess(
        transaction: IMempoolTransactionObj,
    ): Promise<BroadcastResponse> {
        const decodedPsbt = await this.transactionVerifier.verify(transaction.data);
        if (!decodedPsbt) {
            return {
                success: false,
                result: 'Could not decode PSBT',
                id: transaction.id,
            };
        }

        if (
            decodedPsbt.data.estimatedFees <
            this.estimatedBlockFees +
                OPNetConsensus.consensus.PSBT.MINIMAL_PSBT_ACCEPTANCE_FEE_VB_PER_SAT
        ) {
            return {
                success: false,
                result: 'Fee too low',
                id: transaction.id,
            };
        }

        transaction.id = decodedPsbt.data.hash;

        const exist = await this.mempoolRepository.storeIfNotExists(transaction);
        if (exist) {
            return {
                success: false,
                result: 'PSBT already in mempool',
                id: transaction.id,
            };
        }

        const processed = await this.psbtProcessorManager.processPSBT(decodedPsbt);
        if (processed.finalized) {
            const finalized = processed.psbt.extractTransaction();
            const finalizedHex: string = finalized.toHex();

            const txBuffer = finalized.toBuffer();
            const finalTransaction: IMempoolTransactionObj = {
                id: toHex(finalized.getHash(false)),
                previousPsbtId:
                    transaction.previousPsbtId || decodedPsbt.data.hash || transaction.id,

                data: txBuffer,

                psbt: false,
                firstSeen: transaction.firstSeen,
                blockHeight: transaction.blockHeight,
                inputs: [],
                outputs: [],
            };

            if (transaction.id === finalTransaction.id) {
                this.error('Transaction and PSBT identifier are the same.');
                return {
                    success: false,
                    result: 'Transaction and PSBT identifier are the same.',
                    id: finalTransaction.id,
                };
            }

            const submitData: Promise<unknown>[] = [
                this.mempoolRepository.deleteTransactionByIdentifier(transaction.id, true),
                this.broadcastBitcoinTransaction(finalizedHex),
            ];

            const result = await Promise.safeAll(submitData);
            const broadcastResult = result[1] as BroadcastTransactionResult | undefined;

            if (broadcastResult?.success && broadcastResult.result) {
                finalTransaction.id = broadcastResult.result;

                parseAndStoreInputOutputs(txBuffer, transaction);

                await this.mempoolRepository.storeTransaction(finalTransaction);

                return {
                    ...broadcastResult,
                    id: finalTransaction.id,
                    modifiedTransaction: toBase64(finalTransaction.data),
                    finalizedTransaction: true,
                };
            } else {
                return {
                    ...broadcastResult,
                    success: false,
                    id: finalTransaction.id,
                    finalizedTransaction: true,
                };
            }
        } else if (processed.modified) {
            const buffer = processed.psbt.toBuffer();
            const header = new Uint8Array([decodedPsbt.type, decodedPsbt.version]);

            const modifiedTransaction = processed.finalized
                ? buffer
                : concat([header, buffer]);

            const newTransaction: IMempoolTransactionObj = {
                data: modifiedTransaction,
                psbt: true,
                firstSeen: transaction.firstSeen,
                id: processed.hash,
                blockHeight: transaction.blockHeight,
                inputs: [],
                outputs: [],
            };

            await this.mempoolRepository.storeTransaction(newTransaction);

            return {
                success: true,
                result: 'PSBT decoded successfully',
                id: newTransaction.id,
                modifiedTransaction: toBase64(modifiedTransaction),
                finalizedTransaction: processed.finalized ?? false,
            };
        } else {
            return {
                success: true,
                result: 'PSBT unchanged',
                id: transaction.id,
                finalizedTransaction: false,
            };
        }
    }*/
}
