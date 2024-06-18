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
import { BitcoinRPC } from '@btc-vision/bsi-bitcoin-rpc';
import { Config } from '../../../config/Config.js';
import { MempoolRepository } from '../../../db/repositories/MempoolRepository.js';
import { NetworkConverter } from '../../../config/NetworkConverter.js';
import { PSBTProcessorManager } from '../PSBTProcessorManager.js';
import { Network } from 'bitcoinjs-lib';
import { OPNetIdentity } from '../../identity/OPNetIdentity.js';
import { TrustedAuthority } from '../../configurations/manager/TrustedAuthority.js';
import { AuthorityManager } from '../../configurations/manager/AuthorityManager.js';
import { currentConsensusConfig } from '../../configurations/OPNetConsensus.js';
import { xxHash } from '../../hashing/xxhash.js';
import { IMempoolTransactionObj } from '../../../db/interfaces/IMempoolTransaction.js';

export class Mempool extends Logger {
    public readonly logColor: string = '#00ffe1';

    private readonly bitcoinRPC: BitcoinRPC = new BitcoinRPC();
    private readonly psbtVerifier: PSBTTransactionVerifier;
    private readonly psbtProcessorManager: PSBTProcessorManager;

    private readonly db: ConfigurableDBManager = new ConfigurableDBManager(Config);

    #mempoolRepository: MempoolRepository | undefined;

    private readonly currentAuthority: TrustedAuthority = AuthorityManager.getCurrentAuthority();
    private readonly opnetIdentity: OPNetIdentity = new OPNetIdentity(
        Config,
        this.currentAuthority,
    );

    private readonly network: Network = NetworkConverter.getNetwork(
        Config.BLOCKCHAIN.BITCOIND_NETWORK,
    );

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

    public sendMessageToThread: (
        threadType: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ) => Promise<ThreadData | null> = async () => {
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

        await this.db.setup(Config.DATABASE.CONNECTION_TYPE);
        await this.db.connect();

        if (!this.db.db) throw new Error('Database connection not established.');

        await this.bitcoinRPC.init(Config.BLOCKCHAIN);

        this.#mempoolRepository = new MempoolRepository(this.db.db);
        await this.psbtProcessorManager.createRepositories(this.bitcoinRPC);
        await this.psbtVerifier.createRepositories();
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
        const raw: Uint8Array = data.raw;
        const psbt: boolean = data.psbt;
        const identifier = data.identifier;

        if (!identifier) {
            return {
                success: false,
                result: 'No identifier provided',
                identifier: data.identifier,
            };
        }

        // Verify transaction size.
        if (
            psbt &&
            raw.byteLength > currentConsensusConfig.PSBT_MAXIMUM_TRANSACTION_BROADCAST_SIZE
        ) {
            return {
                success: false,
                result: 'PSBT too large',
                identifier: data.identifier,
            };
        } else if (
            !psbt &&
            raw.byteLength > currentConsensusConfig.MAXIMUM_TRANSACTION_BROADCAST_SIZE
        ) {
            return {
                success: false,
                result: 'Transaction too large',
                identifier: data.identifier,
            };
        }

        try {
            const transaction: IMempoolTransactionObj = {
                identifier: identifier,
                psbt: psbt,
                data: raw,
                firstSeen: new Date(),
            };

            if (psbt) {
                return this.decodePSBTAndProcess(transaction);
            } else {
                return this.decodeTransactionAndProcess(transaction);
            }
        } catch (e) {
            if (Config.DEBUG_LEVEL >= DebugLevel.TRACE) {
                this.error(`Error processing transaction: ${(e as Error).stack}`);
            }

            return {
                success: false,
                result: `Bad transaction.`,
                identifier: identifier,
            };
        }
    }

    private async decodeTransactionAndProcess(
        transaction: IMempoolTransactionObj,
    ): Promise<BroadcastResponse> {
        const exist = await this.mempoolRepository.hasTransactionByIdentifier(
            transaction.identifier,
            transaction.psbt,
        );
        if (exist) {
            return {
                success: false,
                result: 'Transaction already in mempool',
                identifier: transaction.identifier,
            };
        }

        const rawHex: string = Buffer.from(transaction.data).toString('hex');
        const broadcasted = await this.broadcastBitcoinTransaction(rawHex);

        if (broadcasted && broadcasted.success && broadcasted.result) {
            transaction.id = broadcasted.result;

            await this.mempoolRepository.storeTransaction(transaction);
        }

        return (
            broadcasted || {
                success: false,
                result: 'Could not broadcast transaction to the network.',
                identifier: transaction.identifier,
            }
        );
    }

    private async decodePSBTAndProcess(
        transaction: IMempoolTransactionObj,
    ): Promise<BroadcastResponse> {
        const decodedPsbt = await this.psbtVerifier.verify(transaction.data);
        if (!decodedPsbt) {
            return {
                success: false,
                result: 'Could not decode PSBT',
                identifier: transaction.identifier,
            };
        }

        transaction.id = decodedPsbt.hash;

        const exist = await this.mempoolRepository.storeIfNotExists(transaction);
        if (exist) {
            return {
                success: false,
                result: 'PSBT already in mempool',
                identifier: transaction.identifier,
            };
        }

        const processed = await this.psbtProcessorManager.processPSBT(decodedPsbt);
        if (processed.finalized) {
            const finalized = processed.psbt.extractTransaction();
            const finalizedHex = finalized.toHex();
            const newIdentifier = xxHash.hash(finalized.toBuffer());

            const finalTransaction: IMempoolTransactionObj = {
                id: finalized.getHash(false).toString('hex'),
                previousPsbtId: transaction.previousPsbtId || decodedPsbt.hash || transaction.id,

                identifier: newIdentifier,
                data: finalized.toBuffer(),

                psbt: false,
                firstSeen: transaction.firstSeen,
            };

            if (transaction.identifier === finalTransaction.identifier) {
                this.error('Transaction and PSBT identifier are the same.');
                return {
                    success: false,
                    result: 'Transaction and PSBT identifier are the same.',
                    identifier: finalTransaction.identifier,
                };
            }

            const submitData: Promise<unknown>[] = [
                this.mempoolRepository.deleteTransactionByIdentifier(transaction.identifier, true),
                this.broadcastBitcoinTransaction(finalizedHex),
            ];

            const result = await Promise.all(submitData);
            const broadcastResult = result[1] as BroadcastResponse | undefined;
            console.log('broadcastResult', broadcastResult);

            if (broadcastResult?.success) {
                await this.mempoolRepository.storeTransaction(finalTransaction);

                return {
                    ...broadcastResult,
                    identifier: finalTransaction.identifier,
                    modifiedTransaction: Buffer.from(finalTransaction.data).toString('base64'),
                    finalizedTransaction: true,
                };
            } else {
                return {
                    ...broadcastResult,
                    success: false,
                    identifier: finalTransaction.identifier,
                    finalizedTransaction: true,
                };
            }
        } else if (processed.modified) {
            const buffer = processed.psbt.toBuffer();
            const header = Buffer.from([decodedPsbt.type, decodedPsbt.version]);

            const modifiedTransaction = processed.finalized
                ? buffer
                : Buffer.concat([header, buffer]);

            const newIdentifier = xxHash.hash(modifiedTransaction);
            const newTransaction: IMempoolTransactionObj = {
                identifier: newIdentifier,
                data: modifiedTransaction,
                psbt: true,
                firstSeen: transaction.firstSeen,
                id: processed.hash,
            };

            await this.mempoolRepository.storeTransaction(newTransaction);

            return {
                success: true,
                result: 'PSBT decoded successfully',
                identifier: newTransaction.identifier,
                modifiedTransaction: modifiedTransaction.toString('base64'),
                finalizedTransaction: processed.finalized ?? false,
            };
        } else {
            return {
                success: true,
                result: 'PSBT unchanged',
                identifier: transaction.identifier,
                finalizedTransaction: false,
            };
        }
    }

    private async broadcastBitcoinTransaction(
        data: string,
    ): Promise<BroadcastResponse | undefined> {
        const currentBlockMsg: RPCMessage<BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_BITCOIN_CORE> =
            {
                type: MessageType.RPC_METHOD,
                data: {
                    rpcMethod: BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_BITCOIN_CORE,
                    data: data,
                } as BroadcastRequest,
            };

        return (await this.sendMessageToThread(ThreadTypes.BITCOIN_RPC, currentBlockMsg)) as
            | BroadcastResponse
            | undefined;
    }
}
