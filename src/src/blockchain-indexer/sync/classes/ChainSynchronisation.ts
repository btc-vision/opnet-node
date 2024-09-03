import { Logger } from '@btc-vision/bsi-common';
import { ThreadTypes } from '../../../threading/thread/enums/ThreadTypes.js';
import { ThreadMessageBase } from '../../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { MessageType } from '../../../threading/enum/MessageType.js';
import { ThreadData } from '../../../threading/interfaces/ThreadData.js';
import { Network } from 'bitcoinjs-lib';
import { NetworkConverter } from '../../../config/network/NetworkConverter.js';
import { BlockFetcher } from '../../fetcher/abstract/BlockFetcher.js';
import { Config } from '../../../config/Config.js';
import { RPCBlockFetcher } from '../../fetcher/RPCBlockFetcher.js';
import { BitcoinRPC } from '@btc-vision/bsi-bitcoin-rpc';
import { Block, DeserializedBlock } from '../../processor/block/Block.js';

export class ChainSynchronisation extends Logger {
    public readonly logColor: string = '#00ffe1';

    private readonly rpcClient: BitcoinRPC = new BitcoinRPC(500, false);
    private readonly network: Network = NetworkConverter.getNetwork();

    constructor() {
        super();
    }

    private _blockFetcher: BlockFetcher | undefined;

    private get blockFetcher(): BlockFetcher {
        if (!this._blockFetcher) {
            throw new Error('BlockFetcher not initialized');
        }

        return this._blockFetcher;
    }

    public sendMessageToThread: (
        type: ThreadTypes,
        message: ThreadMessageBase<MessageType>,
    ) => Promise<ThreadData | null> = async () => {
        throw new Error('sendMessageToThread not implemented.');
    };

    public async init(): Promise<void> {
        await this.rpcClient.init(Config.BLOCKCHAIN);

        this._blockFetcher = new RPCBlockFetcher({
            maximumPrefetchBlocks: Config.OP_NET.MAXIMUM_PREFETCH_BLOCKS,
            rpc: this.rpcClient,
        });
    }

    public async handleMessage(m: ThreadMessageBase<MessageType>): Promise<ThreadData> {
        let resp: ThreadData;
        switch (m.type) {
            case MessageType.DESERIALIZE_BLOCK: {
                resp = await this.deserializeBlock(m);
                break;
            }
            default: {
                throw new Error(
                    `Unknown message type: ${m.type} received in synchronisation thread.`,
                );
            }
        }

        return resp ?? null;
    }

    private async queryBlock(blockNumber: bigint): Promise<DeserializedBlock> {
        const blockData = await this.blockFetcher.getBlock(blockNumber);
        if (!blockData) {
            throw new Error(`Block ${blockNumber} not found`);
        }

        const start = Date.now();
        const block = new Block({
            network: this.network,
            abortController: new AbortController(),
            header: blockData,
        });

        // Deserialize the block
        block.setRawTransactionData(blockData.tx);
        block.deserialize();

        return block.toJSON();
    }

    private async deserializeBlock(m: ThreadMessageBase<MessageType>): Promise<ThreadData> {
        try {
            const blockNumber = m.data as bigint;

            return await this.queryBlock(blockNumber);
        } catch (e) {
            return { error: e };
        }
    }
}
