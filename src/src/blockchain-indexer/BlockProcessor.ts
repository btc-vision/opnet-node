import { ClientSession } from 'mongodb';
import { Config } from '../config/Config.js';
import { DBManagerInstance } from '../db/DBManager.js';
import { IBlockchainInformationDocument } from '../db/documents/interfaces/IBlockchainInformationDocument.js';
import { BlockchainInformationRepository } from '../db/repositories/BlockchainInformationRepository.js';
import {
    BitcoinRPC,
    BlockchainInfo,
    BlockDataWithTransactionData,
    TransactionData,
} from '@btc-vision/bsi-bitcoin-rpc';
import pkg from 'bitcore-lib';
const { Script } = pkg;

class TransactionDetail {}

export class BlockProcessor {
    private rpcClient: BitcoinRPC;
    private blockchainInfoRepository: BlockchainInformationRepository;
    private readonly network: string;

    constructor() {
        this.rpcClient = new BitcoinRPC();

        if (DBManagerInstance.db === null) {
            throw new Error('DBManager instance must be defined');
        }

        this.blockchainInfoRepository = new BlockchainInformationRepository(DBManagerInstance.db);
        this.network = Config.BLOCKCHAIN.BITCOIND_NETWORK;
    }

    public async processBlocks(startBlockHeight: number = -1): Promise<void> {
        const blockchainInfo: IBlockchainInformationDocument =
            await this.blockchainInfoRepository.getByNetwork(this.network);

        // Process block either from the forced start height
        // or from the last in progress block saved in the database
        let blockHeightInProgress: number =
            startBlockHeight !== -1 ? startBlockHeight : blockchainInfo.inProgressBlock;
        let chainCurrentBlockHeight = await this.getChainCurrentBlockHeight();

        while (blockHeightInProgress < chainCurrentBlockHeight) {
            const block = await this.getBlock(blockHeightInProgress);

            await this.processBlock(block);

            chainCurrentBlockHeight = await this.getChainCurrentBlockHeight();
            blockHeightInProgress++;
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

        await this.blockchainInfoRepository.updateCurrentBlockInProgress(
            this.network,
            blockData.height,
        );

        const session: ClientSession = await DBManagerInstance.startSession();

        try {
            for (const transaction in blockData.tx) {
            }

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

    private orderTransactions(blockData: BlockDataWithTransactionData): TransactionDetail[] {
        const transactions: TransactionDetail[] = [];
        for (const transaction of blockData.tx) {
            transactions.push(transaction);
        }

        // order by fees descending
        //transactions.sort((a, b) => b.vout[0].value - a.vout[0].value);

        return transactions;
    }

    private getTargetTransactions(blockData: BlockDataWithTransactionData): TransactionDetail[] {
        const transactions: TransactionDetail[] = [];
        for (const transaction of blockData.tx) {
            if (this.validateIsTaproot(transaction)) {
                const schnorrSignature: string =
                    transaction.vin[0].txinwitness[transaction.vin[0].txinwitness.length - 1];
                const buffer: Buffer = Buffer.from(
                    transaction.vin[0].txinwitness[transaction.vin[0].txinwitness.length - 2],
                );
                const tapScript: pkg.Script = new Script(buffer);
                const merklePath: string =
                    transaction.vin[0].txinwitness[transaction.vin[0].txinwitness.length - 3];
                //!!! What is this key???
                const key: string =
                    transaction.vin[0].txinwitness[transaction.vin[0].txinwitness.length - 4];
                const publicKey: string =
                    transaction.vin[0].txinwitness[transaction.vin[0].txinwitness.length - 5];

                const scriptArray: string[] = tapScript.toString().split(' ');

                if (this.validateMagicNumber(scriptArray)) {
                    const senderSignature: string = scriptArray[1];
                    const from: string = scriptArray[5];
                    const to: string = scriptArray[9];
                    const callData: string = '';

                    let i: number = 18;
                    let done: boolean = false;
                    while (!done) {
                        if (scriptArray[i] === 'OP_PUSHDATA2') {
                            i++;
                            const dataLength: number = parseInt(scriptArray[i]);
                            i++;
                            const data: string = scriptArray[i];

                            if (dataLength === data.length) {
                                i++;
                            } else {
                                //!!! Error
                                throw new Error(
                                    `Error parsing data. Invalid length: ${dataLength}`,
                                );
                            }

                            done = i === scriptArray.length;
                        } else {
                            done = true;
                        }
                    }
                }

                //transactions.push(transaction);
            }
        }

        return transactions;
    }

    private async processTransaction(transactionData: TransactionDetail | null): Promise<void> {
        if (transactionData === null) {
            throw new Error(`Error Cannot process null transaction.`);
        }
    }

    private validateMagicNumber(scriptArray: string[]): boolean {
        return (
            scriptArray.length >= 21 && scriptArray[15] === '3' && scriptArray[16] === '0x627363'
        );
    }

    private validateIsTaproot(transaction: TransactionData): boolean {
        return (
            transaction.vout[0] != null &&
            transaction.vout[0].scriptPubKey.hex.startsWith('51') &&
            transaction.vin[0] != null &&
            transaction.vin[0].txinwitness.length >= 5
        );
    }
}
