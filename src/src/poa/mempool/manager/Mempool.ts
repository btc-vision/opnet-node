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
import { cyrb53a, u8 } from '@btc-vision/bsi-binary';
import { MempoolRepository } from '../../../db/repositories/MempoolRepository.js';
import { NetworkConverter } from '../../../config/NetworkConverter.js';
import { PSBTProcessorManager } from '../PSBTProcessorManager.js';
import { Network } from 'bitcoinjs-lib';
import { OPNetIdentity } from '../../identity/OPNetIdentity.js';
import { TrustedAuthority } from '../../configurations/manager/TrustedAuthority.js';
import { AuthorityManager } from '../../configurations/manager/AuthorityManager.js';

export class Mempool extends Logger {
    public readonly logColor: string = '#00ffe1';

    private readonly bitcoinRPC: BitcoinRPC = new BitcoinRPC();
    private readonly psbtVerifier: PSBTTransactionVerifier;
    private readonly psbtProcessorManager: PSBTProcessorManager;

    private readonly db: ConfigurableDBManager = new ConfigurableDBManager(Config);

    private mempoolRepository: MempoolRepository | undefined;

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

        this.psbtVerifier = new PSBTTransactionVerifier(this.network);
        this.psbtProcessorManager = new PSBTProcessorManager(
            this.opnetIdentity,
            this.db,
            this.network,
        );
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

        this.mempoolRepository = new MempoolRepository(this.db.db);
        this.psbtProcessorManager.createRepositories();
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
        const identifier: bigint = data.identifier || cyrb53a(data.raw as unknown as u8[]);

        try {
            let result: BroadcastResponse = {
                success: false,
                result: 'Could not broadcast transaction to the network.',
                identifier: identifier,
            };

            if (!psbt) {
                const rawHex: string = Buffer.from(raw).toString('hex');

                return (
                    (await this.broadcastBitcoinTransaction(rawHex)) || {
                        success: false,
                        result: 'Could not broadcast transaction to the network.',
                        identifier: identifier,
                    }
                );
            } else {
                const decodedPsbt = await this.psbtVerifier.verify(raw);
                if (!decodedPsbt) {
                    return {
                        success: false,
                        result: 'Could not decode PSBT',
                        identifier: identifier,
                    };
                }

                const processed = await this.psbtProcessorManager.processPSBT(decodedPsbt);
                if (processed.finalized) {
                    const finalized = processed.psbt.extractTransaction();
                    const finalizedHex = finalized.toHex();
                    const broadcastResult = await this.broadcastBitcoinTransaction(finalizedHex);

                    if (broadcastResult) {
                        return {
                            ...broadcastResult,
                            identifier: identifier,
                        };
                    }
                } else if (processed.modified) {
                    const base64 = processed.psbt.toBase64();
                    const header = Buffer.from([decodedPsbt.type]);
                    const modifiedTransaction = Buffer.concat([
                        header,
                        Buffer.from(base64, 'base64'),
                    ]).toString('base64');

                    return {
                        success: true,
                        result: 'PSBT decoded successfully',
                        identifier: identifier,
                        modifiedTransaction: modifiedTransaction,
                    };
                } else {
                    // unchanged.
                    this.info(`PSBT unchanged: ${identifier}`);

                    return {
                        success: false,
                        result: 'PSBT unchanged',
                        identifier: identifier,
                    };
                }
            }

            return result;
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
