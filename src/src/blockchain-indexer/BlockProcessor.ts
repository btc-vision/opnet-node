import { ClientSession } from 'mongodb';
import { Config } from '../config/Config.js';
import { DBManagerInstance } from '../db/DBManager.js';
import { IBlockchainInformationDocument } from '../db/documents/interfaces/IBlockchainInformationDocument.js';
import { BlockchainInformationRepository } from '../db/repositories/BlockchainInformationRepository.js';
import { BitcoinRPC } from './rpc/BitcoinRPC.js';
import { BlockchainInfo } from './rpc/types/BlockchainInfo.js';
import { BlockDataWithTransactionData } from './rpc/types/BlockData.js';

export class BlockProcessor {
    private rpcClient: BitcoinRPC;
    private blockchainInfoRepository: BlockchainInformationRepository;

    constructor() {
        this.rpcClient = new BitcoinRPC();

        if (DBManagerInstance.db === null) {
            throw new Error('DBManager instance must be defined');
        }

        this.blockchainInfoRepository = new BlockchainInformationRepository(DBManagerInstance.db);
    }

    public async processBlocks(startBlockHeight: number = -1): Promise<void> {
        const blockchainInfo: IBlockchainInformationDocument =
            await this.blockchainInfoRepository.getByNetwork(Config.BLOCKCHAIN.BITCOIND_NETWORK);

        // No forced start block height
        if (startBlockHeight === -1) {
            // Check for block to rescan
            for (const rescanHeight of blockchainInfo.toRescanBlock) {
                const block = await this.getBlock(rescanHeight);

                await this.processBlock(block);
            }
        }

        // Process block either from the forced start height
        // or from the last in progress block saved in the database
        let blockHeightInProgess: number =
            startBlockHeight !== -1 ? startBlockHeight : blockchainInfo.inProgressBlock;
        let chainCurrentBlockHeight = await this.getChainCurrentBlockHeight();

        while (blockHeightInProgess < chainCurrentBlockHeight) {
            const block = await this.getBlock(blockHeightInProgess);

            await this.processBlock(block);

            chainCurrentBlockHeight = await this.getChainCurrentBlockHeight();
            blockHeightInProgess++;
        }
    }

    private async getChainCurrentBlockHeight(): Promise<number> {
        const chainInfo: BlockchainInfo | null = await this.rpcClient.getChainInfo();

        if (chainInfo == null) {
            throw new Error(`Error fetching blockchain information.`);
        }

        return chainInfo.blocks;
    }

    private async getBlock(blockHeight: number): Promise<BlockDataWithTransactionData | null> {
        try {
            const blockHash: string | null = await this.rpcClient.getBlockHash(blockHeight);

            if (blockHash == null) {
                throw new Error(`Error fetching block hash.`);
            }

            return await this.rpcClient.getBlockInfoWithTransactionData(blockHash);
        } catch (e: unknown) {
            const error = e as Error;
            throw new Error(`Error fetching block information: ${error.message}`);
        }
    }

    private async processBlock(blockData: BlockDataWithTransactionData | null): Promise<boolean> {
        if (blockData === null) {
            throw new Error(`Error Cannot process null block.`);
        }

        let result: boolean = false;

        const session: ClientSession = await DBManagerInstance.startSession();

        try {
            await session.commitTransaction();
            result = true;
        } catch (e: unknown) {
            const error = e as Error;
            await session.abortTransaction();
        } finally {
            await session.endSession();
        }

        return result;
    }
}
