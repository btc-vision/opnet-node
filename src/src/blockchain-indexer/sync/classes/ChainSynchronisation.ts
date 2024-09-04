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
import { TransactionData } from '@btc-vision/bsi-bitcoin-rpc/build/rpc/types/BlockData.js';
import {
    ProcessUnspentTransactionList,
    UnspentTransactionRepository,
} from '../../../db/repositories/UnspentTransactionRepository.js';
import { DBManagerInstance } from '../../../db/DBManager.js';

export class ChainSynchronisation extends Logger {
    public readonly logColor: string = '#00ffe1';

    private readonly rpcClient: BitcoinRPC = new BitcoinRPC(500, false);
    private readonly network: Network = NetworkConverter.getNetwork();

    private unspentTransactionOutputs: ProcessUnspentTransactionList = [];
    private amountOfUTXOs: number = 0;

    constructor() {
        super();
    }

    private _unspentTransactionRepository: UnspentTransactionRepository | undefined;

    private get unspentTransactionRepository(): UnspentTransactionRepository {
        if (!this._unspentTransactionRepository) {
            throw new Error('UnspentTransactionRepository not initialized');
        }

        return this._unspentTransactionRepository;
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
        if (!DBManagerInstance.db) throw new Error('Database not initialized');

        await this.rpcClient.init(Config.BLOCKCHAIN);

        this._blockFetcher = new RPCBlockFetcher({
            maximumPrefetchBlocks: Config.OP_NET.MAXIMUM_PREFETCH_BLOCKS,
            rpc: this.rpcClient,
        });

        this._unspentTransactionRepository = new UnspentTransactionRepository(DBManagerInstance.db);

        await this.startSaveLoop();
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

    private async startSaveLoop(): Promise<void> {
        if (this.unspentTransactionOutputs.length) {
            await this.saveUTXOs();
        }

        setTimeout(() => {
            this.startSaveLoop();
        }, 100);
    }

    private async saveUTXOs(): Promise<void> {
        const utxos = this.unspentTransactionOutputs;
        this.unspentTransactionOutputs = [];
        this.amountOfUTXOs = 0;

        await this.unspentTransactionRepository.insertTransactions(utxos);

        this.success(`Saved ${utxos.length} block UTXOs to database.`);
    }

    private awaitUTXOWrites(): Promise<void> {
        this.important('Awaiting UTXO writes to complete... Can take a while.');
        return new Promise(async (resolve) => {
            while (this.unspentTransactionOutputs.length) {
                await new Promise((r) => setTimeout(r, 100));
            }

            resolve();
        });
    }

    private async queryUTXOs(block: Block, txs: TransactionData[]): Promise<void> {
        block.setRawTransactionData(txs);
        block.deserialize();

        // Save UTXOs
        const utxos = block.getUTXOs();

        this.amountOfUTXOs += utxos.length;

        // Save UTXOs to database
        this.unspentTransactionOutputs = this.unspentTransactionOutputs.concat({
            blockHeight: block.header.height,
            transactions: utxos,
        });
    }

    private async queryBlock(blockNumber: bigint): Promise<DeserializedBlock> {
        // bigger than 10_000
        if (this.amountOfUTXOs > 10_000) {
            await this.awaitUTXOWrites();
        }

        const blockData = await this.blockFetcher.getBlock(blockNumber);
        if (!blockData) {
            throw new Error(`Block ${blockNumber} not found`);
        }

        const block = new Block({
            network: this.network,
            abortController: new AbortController(),
            header: blockData,
        });

        void this.queryUTXOs(block, blockData.tx);

        // Deserialize the block
        //block.setRawTransactionData(blockData.tx);
        //block.deserialize();

        return {
            //block.toJSON(); will become handy later.
            header: block.header.toJSON(),
            rawTransactionData: blockData.tx,
            transactionOrder: undefined,
        };
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
