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
import { PSBTTransactionVerifier } from '../psbt/PSBTTransactionVerifier.js';
import { BitcoinRPC, FeeEstimation } from '@btc-vision/bitcoin-rpc';
import { Config } from '../../../config/Config.js';
import { MempoolRepository } from '../../../db/repositories/MempoolRepository.js';
import { NetworkConverter } from '../../../config/network/NetworkConverter.js';
import { PSBTProcessorManager } from '../PSBTProcessorManager.js';
import { Network } from '@btc-vision/bitcoin';
import { OPNetIdentity } from '../../identity/OPNetIdentity.js';
import { TrustedAuthority } from '../../configurations/manager/TrustedAuthority.js';
import { AuthorityManager } from '../../configurations/manager/AuthorityManager.js';
import { IMempoolTransactionObj } from '../../../db/interfaces/IMempoolTransaction.js';
import { OPNetConsensus } from '../../configurations/OPNetConsensus.js';
import { BlockchainInfoRepository } from '../../../db/repositories/BlockchainInfoRepository.js';
import { TransactionSizeValidator } from '../data-validator/TransactionSizeValidator.js';
import { parseAndStoreInputOutputs } from '../../../utils/TransactionMempoolUtils.js';

export class Mempool extends Logger {
    public readonly logColor: string = '#00ffe1';

    private readonly bitcoinRPC: BitcoinRPC = new BitcoinRPC();
    private readonly psbtVerifier: PSBTTransactionVerifier;
    private readonly psbtProcessorManager: PSBTProcessorManager;
    private readonly transactionSizeValidator: TransactionSizeValidator =
        new TransactionSizeValidator();

    private readonly db: ConfigurableDBManager = new ConfigurableDBManager(Config);

    #blockchainInformationRepository: BlockchainInfoRepository | undefined;
    #mempoolRepository: MempoolRepository | undefined;

    private readonly currentAuthority: TrustedAuthority = AuthorityManager.getCurrentAuthority();
    private readonly opnetIdentity: OPNetIdentity = new OPNetIdentity(
        Config,
        this.currentAuthority,
    );

    private readonly network: Network = NetworkConverter.getNetwork();

    private estimatedBlockFees: bigint = 0n;

    constructor() {
        super();

        this.psbtVerifier = new PSBTTransactionVerifier(this.db, this.network);
        this.psbtProcessorManager = new PSBTProcessorManager(
            this.opnetIdentity,
            this.db,
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

        this.#mempoolRepository = new MempoolRepository(this.db.db);
        this.#blockchainInformationRepository = new BlockchainInfoRepository(this.db.db);

        await Promise.safeAll([
            this.watchBlockchain(),
            this.estimateFees(),
            this.psbtProcessorManager.createRepositories(this.bitcoinRPC),
            this.psbtVerifier.createRepositories(),
        ]);
    }

    private async watchBlockchain(): Promise<void> {
        this.blockchainInformationRepository.watchBlockChanges((blockHeight: bigint) => {
            try {
                OPNetConsensus.setBlockHeight(blockHeight);

                if (Config.MEMPOOL.ENABLE_BLOCK_PURGE) {
                    void this.mempoolRepository.purgeOldTransactions(blockHeight);
                }
            } catch {}
        });

        await this.blockchainInformationRepository.getCurrentBlockAndTriggerListeners(
            Config.BITCOIN.NETWORK,
        );
    }

    private async estimateFees(): Promise<void> {
        try {
            const fees = await this.bitcoinRPC.estimateSmartFee(2, FeeEstimation.CONSERVATIVE);
            if ('errors' in fees && fees.errors) {
                throw new Error(fees.errors.join(' '));
            }

            if ('feerate' in fees) {
                const fee: number = fees.feerate as number;
                const estimatedFee = Math.ceil((fee * 100000000) / 1024);

                this.estimatedBlockFees = BigInt(estimatedFee);
            }

            // If fee is too low, set it to the minimum. bigint.
            this.estimatedBlockFees =
                this.estimatedBlockFees <
                OPNetConsensus.consensus.PSBT.MINIMAL_PSBT_ACCEPTANCE_FEE_VB_PER_SAT
                    ? OPNetConsensus.consensus.PSBT.MINIMAL_PSBT_ACCEPTANCE_FEE_VB_PER_SAT
                    : this.estimatedBlockFees;

            if (Config.DEBUG_LEVEL >= DebugLevel.ALL) {
                this.log(`Estimated fees: ${this.estimatedBlockFees}`);
            }
        } catch (e) {
            if (Config.DEBUG_LEVEL >= DebugLevel.TRACE) {
                this.error(`Error estimating fees: ${(e as Error).message}`);
            }
        }

        setTimeout(() => {
            void this.estimateFees();
        }, 20000);
    }

    private async onRPCMethod(m: RPCMessageData<BitcoinRPCThreadMessageType>): Promise<ThreadData> {
        switch (m.rpcMethod) {
            case BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET: {
                return await this.onTransactionReceived(m.data as OPNetBroadcastData);
            }

            default: {
                throw new Error(`Unknown message sent by thread of type: ${m.rpcMethod}`);
            }
        }
    }

    private async onTransactionReceived(data: OPNetBroadcastData): Promise<BroadcastResponse> {
        if (!OPNetConsensus.hasConsensus()) {
            return {
                success: false,
                result: 'Consensus not reached',
                id: data.id,
            };
        }

        const raw: Uint8Array = data.raw;
        const psbt: boolean = data.psbt;
        const id = data.id;

        if (!id) {
            return {
                success: false,
                result: 'No transaction hash provided',
                id: id,
            };
        }

        if (this.transactionSizeValidator.verifyTransactionSize(raw.byteLength, psbt)) {
            return {
                success: false,
                result: 'Transaction too large',
                id: id,
            };
        }

        try {
            const transaction: IMempoolTransactionObj = {
                id: id,
                psbt: psbt,
                data: raw,
                firstSeen: new Date(),
                blockHeight: OPNetConsensus.getBlockHeight(),
                inputs: [],
                outputs: [],
            };

            if (psbt) {
                throw new Error(`PSBTs support is current disabled.`);
                //return await this.decodePSBTAndProcess(transaction);
            } else {
                return await this.decodeTransactionAndProcess(transaction);
            }
        } catch (e) {
            console.log(`Error processing transaction: ${(e as Error).stack}`);

            if (Config.DEBUG_LEVEL >= DebugLevel.TRACE) {
                this.error(`Error processing transaction: ${(e as Error).stack}`);
            }

            return {
                success: false,
                result: `Bad transaction.`,
                id: id,
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
                id: transaction.id,
            };
        }

        const buf = Buffer.from(transaction.data);
        const rawHex: string = buf.toString('hex');

        const broadcast = await this.broadcastBitcoinTransaction(rawHex);
        if (broadcast && broadcast.success && broadcast.result) {
            transaction.id = broadcast.result;

            parseAndStoreInputOutputs(buf, transaction);

            await this.mempoolRepository.storeTransaction(transaction);
        }

        console.log(broadcast);

        return (
            broadcast || {
                success: false,
                result: 'Could not broadcast transaction to the network.',
                id: transaction.id,
            }
        );
    }

    /*private async decodePSBTAndProcess(
        transaction: IMempoolTransactionObj,
    ): Promise<BroadcastResponse> {
        const decodedPsbt = await this.psbtVerifier.verify(transaction.data);
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
                id: finalized.getHash(false).toString('hex'),
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
                    modifiedTransaction: Buffer.from(finalTransaction.data).toString('base64'),
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
            const header = Buffer.from([decodedPsbt.type, decodedPsbt.version]);

            const modifiedTransaction = processed.finalized
                ? buffer
                : Buffer.concat([header, buffer]);

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
                modifiedTransaction: modifiedTransaction.toString('base64'),
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

        return (await this.sendMessageToThread(ThreadTypes.RPC, currentBlockMsg)) as
            | BroadcastResponse
            | undefined;
    }
}
