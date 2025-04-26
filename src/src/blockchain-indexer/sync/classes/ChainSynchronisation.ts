import { Logger } from '@btc-vision/bsi-common';
import { ThreadTypes } from '../../../threading/thread/enums/ThreadTypes.js';
import { ThreadMessageBase } from '../../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { MessageType } from '../../../threading/enum/MessageType.js';
import { ThreadData } from '../../../threading/interfaces/ThreadData.js';
import { Network } from '@btc-vision/bitcoin';
import { NetworkConverter } from '../../../config/network/NetworkConverter.js';
import { BlockFetcher } from '../../fetcher/abstract/BlockFetcher.js';
import { Config } from '../../../config/Config.js';
import { RPCBlockFetcher } from '../../fetcher/RPCBlockFetcher.js';
import { BitcoinRPC } from '@btc-vision/bitcoin-rpc';
import { Block, DeserializedBlock } from '../../processor/block/Block.js';
import { TransactionData } from '@btc-vision/bitcoin-rpc/build/rpc/types/BlockData.js';
import {
    ProcessUnspentTransactionList,
    UnspentTransactionRepository,
} from '../../../db/repositories/UnspentTransactionRepository.js';
import { DBManagerInstance } from '../../../db/DBManager.js';
import { IChainReorg } from '../../../threading/interfaces/thread-messages/messages/indexer/IChainReorg.js';
import { PublicKeysRepository } from '../../../db/repositories/PublicKeysRepository.js';
import { BlockRepository } from '../../../db/repositories/BlockRepository.js';

export class ChainSynchronisation extends Logger {
    public readonly logColor: string = '#00ffe1';

    private readonly rpcClient: BitcoinRPC = new BitcoinRPC(500, false);
    private readonly network: Network = NetworkConverter.getNetwork();

    private unspentTransactionOutputs: ProcessUnspentTransactionList = [];
    private amountOfUTXOs: number = 0;
    private isProcessing: boolean = false;

    private abortControllers: Map<bigint, AbortController> = new Map();
    private pendingSave: Promise<void> | undefined;

    private readonly AWAIT_UTXO_WRITE_IF_QUEUE_SIZE: number = 200_000;

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

    private _blockRepository: BlockRepository | undefined;

    private get blockRepository(): BlockRepository {
        if (!this._blockRepository) {
            throw new Error('BlockRepository not initialized');
        }

        return this._blockRepository;
    }

    private _publicKeysRepository: PublicKeysRepository | undefined;

    private get publicKeysRepository(): PublicKeysRepository {
        if (!this._publicKeysRepository) {
            throw new Error('PublicKeysRepository not initialized');
        }

        return this._publicKeysRepository;
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
        this._publicKeysRepository = new PublicKeysRepository(DBManagerInstance.db);
        this._blockRepository = new BlockRepository(DBManagerInstance.db);

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
        }, Config.INDEXER.UTXO_SAVE_INTERVAL);
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
        if (this.pendingSave) {
            await this.pendingSave;
        } else {
            this.isProcessing = true;
            this.pendingSave = this._saveUTXOs();
            await this.pendingSave;
            this.pendingSave = undefined;
            this.isProcessing = false;
        }
    }

    private async _saveUTXOs(): Promise<void> {
        const utxos = this.unspentTransactionOutputs;
        this.purgeUTXOs();

        try {
            await this.publicKeysRepository.processPublicKeys(utxos);
        } catch (e) {
            this.error(`TODO: FIX THIS ERROR ${e}`);
        }

        try {
            await this.unspentTransactionRepository.insertTransactions(utxos);

            this.success(`Saved ${utxos.length} block UTXOs to database.`);
        } catch (e) {
            this.error(`${e}`);
            this.fail(`Failed to save UTXOs to database. ${(e as Error).message}`);
        }
    }

    private async awaitUTXOWrites(): Promise<void> {
        await this.saveUTXOs();

        this.warn('Awaiting UTXO writes to complete... May take a while.');

        while (this.isProcessing) {
            await new Promise((r) => setTimeout(r, 100));
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

    /**
     * By default, this means that the minimum activation block for OPNet is block 100.
     * On bitcoin, mined coins cant be spent before 100 blocks anyway.
     * @param blockNumber
     * @private
     */
    private async getPreimages(blockNumber: bigint): Promise<Buffer[]> {
        const hashes = await this.blockRepository.getBlockPreimages(blockNumber);
        if (!hashes.length) {
            return [];
        }

        return hashes.map((hash) => Buffer.from(hash, 'hex'));
    }

    // TODO: Move fetching to an other thread.
    private async queryBlock(blockNumber: bigint): Promise<DeserializedBlock> {
        const [blockData, allowedPreimages] = await Promise.safeAll([
            this.blockFetcher.getBlock(blockNumber),
            this.getPreimages(blockNumber),
        ]);

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
            allowedPreimages: allowedPreimages,
        });

        // Deserialize the block
        this.queryUTXOs(block, blockData.tx);

        this.abortControllers.delete(blockNumber);

        if (this.amountOfUTXOs > this.AWAIT_UTXO_WRITE_IF_QUEUE_SIZE) {
            await this.awaitUTXOWrites();
        }

        return {
            //block.toJSON(); will become handy later.
            header: block.header.toJSON(),
            rawTransactionData: blockData.tx,
            transactionOrder: undefined,
            allowedPreimages: allowedPreimages,
        };
    }

    /*private async deserializeBlockBatch(startBlock: bigint): Promise<ThreadData> {
        // Instead of calling queryBlocks(...) directly, call getBlocks(...) from BlockFetcher
        const blocksData = await this.blockFetcher.getBlocks(startBlock, 10);

        // For each block returned, do the same processing you'd do for a single block
        const result: DeserializedBlock[] = [];
        for (let i = 0; i < blocksData.length; i++) {
            const blockNumber = startBlock + BigInt(i);

            const abortController = new AbortController();
            this.abortControllers.set(blockNumber, abortController);

            // Convert raw block data into a "Block" class instance
            const block = new Block({
                network: this.network,
                abortController,
                header: blocksData[i],
                processEverythingAsGeneric: true,
            });

            // Pull out UTXOs
            this.queryUTXOs(block, blocksData[i].tx);

            // Clean up the abort controller
            this.abortControllers.delete(blockNumber);

            result.push({
                header: block.header.toJSON(),
                rawTransactionData: blocksData[i].tx,
                transactionOrder: undefined,
            });
        }

        // If we have a lot of UTXOs, do a flush
        if (this.amountOfUTXOs > this.AWAIT_UTXO_WRITE_IF_QUEUE_SIZE) {
            await this.awaitUTXOWrites();
        }

        // Return all blocks if your system expects an array
        return { blocks: result };
    }*/

    private async deserializeBlock(m: ThreadMessageBase<MessageType>): Promise<ThreadData> {
        try {
            const startBlock = m.data as bigint;

            //if (Config.OP_NET.ENABLE_BATCH_PROCESSING) {
            //    return await this.deserializeBlockBatch(startBlock);
            //} else {
            return await this.queryBlock(startBlock);
            //}
        } catch (e) {
            return { error: e };
        }
    }
}
