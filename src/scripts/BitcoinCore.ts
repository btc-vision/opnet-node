import { Logger } from '@btc-vision/motoswapcommon';

import * as bitcoin from 'bitcoinjs-lib';
import { Network } from 'bitcoinjs-lib/src/networks.js';
import bitcore from 'bitcore-lib';
import { ECPairInterface } from 'ecpair';

import { BitcoinHelper } from '../src/bitcoin/BitcoinHelper.js';
import { BitcoinRPC } from '../src/blockchain-indexer/rpc/BitcoinRPC.js';
import {
    BitcoinRawTransactionParams,
    TransactionDetail,
} from '../src/blockchain-indexer/rpc/types/BitcoinRawTransaction.js';
import { BitcoinVerbosity } from '../src/blockchain-indexer/rpc/types/BitcoinVerbosity.js';
import { Config } from '../src/config/Config.js';

export interface RawWalletInformation {
    readonly walletAddress: string;
    readonly publicKey: string;
    readonly privateKey: string;
}

export interface WalletInformation {
    readonly walletAddress: string;
    readonly publicKey: Buffer;
    readonly privateKeyWIF: string;

    compressedAddress: string | null;
    keypair: ECPairInterface | null;
}

export abstract class BitcoinCore extends Logger {
    public readonly logColor: string = '#5dbcef';

    protected readonly defaultWalletName: string = 'default';
    protected bitcoinRPC: BitcoinRPC = new BitcoinRPC();

    protected walletInformation: WalletInformation | null = null;

    protected readonly network: Network;
    protected readonly networkBitcore: bitcore.Network;

    protected constructor() {
        super();

        switch (Config.BLOCKCHAIN.BITCOIND_NETWORK) {
            case 'mainnet':
                this.network = bitcoin.networks.bitcoin;
                this.networkBitcore = bitcore.Networks.mainnet;
                break;
            case 'testnet':
                this.network = bitcoin.networks.testnet;
                this.networkBitcore = bitcore.Networks.testnet;
                break;
            case 'regtest':
                this.network = bitcoin.networks.regtest;
                bitcore.Networks.enableRegtest();
                this.networkBitcore = bitcore.Networks.get('regtest');
                break;
            default:
                throw new Error('Invalid network');
        }
    }

    public async init(): Promise<void> {
        this.log('Bitcoin core initializing...');

        await this.bitcoinRPC.init(Config.BLOCKCHAIN);
    }

    protected getKeyPair(): ECPairInterface {
        if (!this.walletInformation) throw new Error('Wallet information not set');
        if (!this.walletInformation.keypair) throw new Error('Keypair not set');

        return this.walletInformation.keypair;
    }

    protected getWalletAddress(): string {
        if (!this.walletInformation) throw new Error('Wallet information not set');

        return this.walletInformation.walletAddress;
    }

    protected async getTransactionFromHash(txHash: string): Promise<TransactionDetail | null> {
        const params: BitcoinRawTransactionParams = {
            txId: txHash,
        };

        const txInfo = await this.bitcoinRPC.getRawTransaction<BitcoinVerbosity.NONE>(params);
        if (!txInfo) {
            return null;
        }

        return txInfo;
    }

    protected async mineBlock(blockCount: number): Promise<TransactionDetail> {
        const wallet = this.walletInformation?.walletAddress;
        if (!wallet) throw new Error('Wallet address not set');

        const blocks = await this.bitcoinRPC.generateToAddress(
            blockCount,
            wallet,
            this.defaultWalletName,
        );

        if (!blocks) {
            throw new Error('Failed to mine block');
        }

        if (blocks.length === 0) throw new Error('No blocks mined. Something went wrong.');
        this.log(`Mined ${blocks.length} blocks`);

        const blockHash = blocks[0];
        this.log(`Block hash: ${blockHash}`);

        return this.getFundingTransactionFromBlockHash(blockHash);
    }

    protected async setWallet(walletInfo: RawWalletInformation): Promise<void> {
        this.walletInformation = {
            walletAddress: walletInfo.walletAddress,
            publicKey: Buffer.from(walletInfo.publicKey, 'hex'),
            privateKeyWIF: walletInfo.privateKey,

            compressedAddress: null,
            keypair: null,
        };

        await this.loadWallet();

        await this.mineBlock(50);

        //await this.mineBlock(1);

        // we get UXTOs after loading the wallet
        /*const lastTx = await this.getTransactionFromHash(
            '7b1d3ae3cee88f377248907d9e5a8d70c4103b84c7405060d737e4edf387c6f3',
        );*/
    }

    protected async getFundingTransactionFromBlockHash(
        blockHash: string,
    ): Promise<TransactionDetail> {
        const blockData = await this.bitcoinRPC.getBlockInfoOnly(blockHash);
        if (!blockData) throw new Error('Failed to get block data');

        const txs = blockData.tx;
        if (!txs || !txs[0]) throw new Error('No transactions found in block');

        const txHash = txs[0];
        this.log(`Transaction hash: ${txHash}`);

        const params: BitcoinRawTransactionParams = {
            txId: txHash,
        };

        const txInfo = await this.bitcoinRPC.getRawTransaction<BitcoinVerbosity.NONE>(params);
        if (!txInfo) throw new Error('Failed to get transaction info');

        return txInfo;
    }

    private async loadWallet(): Promise<void> {
        this.log('Loading wallet...');

        if (this.walletInformation === null) {
            throw new Error('Wallet information not set');
        }

        const fromWIF = BitcoinHelper.fromWIF(this.walletInformation.privateKeyWIF, this.network);
        const pubKey = fromWIF.publicKey.toString('hex');

        if (pubKey !== this.walletInformation.publicKey.toString('hex')) {
            throw new Error(
                `Public key mismatch ${pubKey} !== ${this.walletInformation.publicKey.toString('hex')}`,
            );
        }

        const legacyWalletAddress: string = BitcoinHelper.getLegacyAddress(fromWIF, this.network);
        const walletAddress: string = BitcoinHelper.getP2WPKHAddress(fromWIF, this.network);

        this.walletInformation.compressedAddress = legacyWalletAddress;
        this.walletInformation.keypair = fromWIF;

        if (walletAddress !== this.walletInformation.walletAddress) {
            throw new Error(
                `Wallet address mismatch ${walletAddress} !== ${this.walletInformation.walletAddress}`,
            );
        }

        this.success(
            `Wallet loaded as ${walletAddress} with uncompressed address ${this.walletInformation.walletAddress}`,
        );
    }
}
