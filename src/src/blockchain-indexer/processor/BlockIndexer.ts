import { Logger } from '@btc-vision/bsi-common';
import { ServerThread } from '../../api/ServerThread.js';
import { Config } from '../../config/Config.js';
import { DBManagerInstance } from '../../db/DBManager.js';
import { BlockchainInformationRepository } from '../../db/repositories/BlockchainInformationRepository.js';
import { MessageType } from '../../threading/enum/MessageType.js';
import { GetBlock } from '../../threading/interfaces/thread-messages/messages/api/GetBlock.js';
import { RPCMessage } from '../../threading/interfaces/thread-messages/messages/api/RPCMessage.js';
import { ThreadMessageBase } from '../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../../threading/interfaces/ThreadData.js';
import { ThreadTypes } from '../../threading/thread/enums/ThreadTypes.js';
import { BitcoinRPCThreadMessageType } from '../rpc/thread/messages/BitcoinRPCThreadMessage.js';

export class BlockIndexer extends Logger {
    public readonly logColor: string = '#00ff00';

    private readonly network: string;

    constructor() {
        super();

        this.network = Config.BLOCKCHAIN.BITCOIND_NETWORK;
    }

    private _blockchainInfoRepository: BlockchainInformationRepository | undefined;

    protected get blockchainInfoRepository(): BlockchainInformationRepository {
        if (this._blockchainInfoRepository === undefined) {
            throw new Error('BlockchainInformationRepository not initialized');
        }

        return this._blockchainInfoRepository;
    }

    public async start(): Promise<void> {
        if (DBManagerInstance.db === null) {
            throw new Error('DBManager instance must be defined');
        }

        this._blockchainInfoRepository = new BlockchainInformationRepository(DBManagerInstance.db);

        const currentBlockMsg: RPCMessage<BitcoinRPCThreadMessageType.GET_CURRENT_BLOCK> = {
            type: MessageType.RPC_METHOD,
            data: {
                rpcMethod: BitcoinRPCThreadMessageType.GET_CURRENT_BLOCK,
            } as GetBlock,
        };

        const currentBlock = await ServerThread.sendMessageToThread(
            ThreadTypes.BITCOIN_RPC,
            currentBlockMsg,
        );

        console.log(JSON.stringify(currentBlock, null, 4));
    }

    public async sendMessageToThread(
        _threadType: ThreadTypes,
        _m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | null> {
        throw new Error('Method not implemented.');
    }

    protected async requestRPCMethod<T extends BitcoinRPCThreadMessageType>(
        m: RPCMessage<T>,
    ): Promise<ThreadData | null> {
        return await this.sendMessageToThread(ThreadTypes.BITCOIN_RPC, m);
    }

    /*private async getChainCurrentBlockHeight(): Promise<number> {
        const chainInfo: BlockchainInfo | null = await this.rpcClient.getChainInfo();

        if (chainInfo == null) {
            throw new Error(`Error fetching blockchain information.`);
        }

        return chainInfo.blocks;
    }*/
}
