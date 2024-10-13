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
import { IChainReorg } from '../../../threading/interfaces/thread-messages/messages/indexer/IChainReorg.js';

export class ChainSynchronisation extends Logger {
    public readonly logColor: string = '#00ffe1';

    private readonly rpcClient: BitcoinRPC = new BitcoinRPC(500, false);
    private readonly network: Network = NetworkConverter.getNetwork();

    private unspentTransactionOutputs: ProcessUnspentTransactionList = [];
    private amountOfUTXOs: number = 0;
    private isProcessing: boolean = false;

    private abortControllers: Map<bigint, AbortController> = new Map();

    public constructor() {
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
    ) => Promise<ThreadData | null> = () => {
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
            case MessageType.CHAIN_REORG: {
                resp = await this.onReorg(m.data as IChainReorg);
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

    private async onReorg(reorg: IChainReorg): Promise<ThreadData> {
        this.panic(`CHAIN_REORG message received. Cancelling all tasks.`);

        this.blockFetcher.onReorg();
        this.abortAllControllers();
        this.purgeUTXOs(reorg.fromHeight);

        if (this.isProcessing) {
            await this.awaitUTXOWrites();
        }

        return {};
    }

    private async startSaveLoop(): Promise<void> {
        if (this.unspentTransactionOutputs.length) {
            await this.saveUTXOs();
        }

        setTimeout(() => {
            void this.startSaveLoop();
        }, 2500);
    }

    private purgeUTXOs(fromBlock?: bigint): void {
        if (fromBlock === undefined) {
            this.unspentTransactionOutputs = [];
            this.amountOfUTXOs = 0;

            return;
        }

        this.unspentTransactionOutputs = this.unspentTransactionOutputs.filter(
            (utxo) => utxo.blockHeight < fromBlock, // do not include the same block, this one must be purged.
        );

        this.amountOfUTXOs = this.unspentTransactionOutputs.reduce(
            (acc, utxo) => acc + utxo.transactions.length,
            0,
        );
    }

    private async saveUTXOs(): Promise<void> {
        if (this.isProcessing) return;
        this.isProcessing = true;

        const utxos = this.unspentTransactionOutputs;
        this.purgeUTXOs();

        try {
            await this.unspentTransactionRepository.insertTransactions(utxos);

            this.success(`Saved ${utxos.length} block UTXOs to database.`);
        } catch (e) {
            this.fail(`Failed to save UTXOs to database. ${(e as Error).message}`);
        }

        this.isProcessing = false;
    }

    private async awaitUTXOWrites(): Promise<void> {
        if (!this.isProcessing) await this.saveUTXOs();

        this.warn('Awaiting UTXO writes to complete... May take a while.');

        while (this.isProcessing) {
            await new Promise((r) => setTimeout(r, 50));
        }
    }

    private abortAllControllers(): void {
        for (const controller of this.abortControllers.values()) {
            controller.abort('Process cancelled');
        }

        this.abortControllers.clear();
    }

    private queryUTXOs(block: Block, txs: TransactionData[]): void {
        block.setRawTransactionData(txs);
        block.deserialize(false);

        // Save UTXOs
        const utxos = block.getUTXOs();

        this.amountOfUTXOs += utxos.length;

        // Save UTXOs to database
        this.unspentTransactionOutputs = this.unspentTransactionOutputs.concat({
            blockHeight: block.header.height,
            transactions: utxos,
        });
    }

    private async getBlockHeightForEver(): Promise<bigint> {
        let height: bigint | undefined = undefined;

        do {
            try {
                height = await this.blockFetcher.getChainHeight();

                if (height != undefined) break;
            } catch (e) {
                this.error(`Failed to get chain height: ${(e as Error).message}`);
            }
        } while (height == undefined);

        return height;
    }

    // TODO: Move fetching to an other thread.
    private async queryBlock(blockNumber: bigint): Promise<DeserializedBlock> {
        if (this.amountOfUTXOs > 100_000) {
            await this.awaitUTXOWrites();
        }

        const blockData = await this.blockFetcher.getBlock(blockNumber);
        if (!blockData) {
            const chainHeight = await this.getBlockHeightForEver();
            if (blockNumber > chainHeight) {
                throw new Error(`Block ${blockNumber} not found`);
            }

            // And we retry forever.
            return new Promise((r) => setTimeout(() => r(this.queryBlock(blockNumber)), 1000));
        }

        const abortController = new AbortController();
        this.abortControllers.set(blockNumber, abortController);

        const block = new Block({
            network: this.network,
            abortController: abortController,
            header: blockData,
            processEverythingAsGeneric: true,
        });

        // Deserialize the block
        this.queryUTXOs(block, blockData.tx);

        this.abortControllers.delete(blockNumber);

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
