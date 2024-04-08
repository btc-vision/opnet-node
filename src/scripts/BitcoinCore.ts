import { Logger } from '@btc-vision/motoswapcommon';

// @ts-ignore
import * as _BIP84 from 'bip84';

import * as bitcoin from 'bitcoinjs-lib';
import { Network } from 'bitcoinjs-lib/src/networks.js';
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
    protected lastTx: TransactionDetail | null = null;

    protected constructor() {
        super();

        switch (Config.BLOCKCHAIN.BITCOIND_NETWORK) {
            case 'mainnet':
                this.network = bitcoin.networks.bitcoin;
                break;
            case 'testnet':
                this.network = bitcoin.networks.testnet;
                break;
            case 'regtest':
                this.network = bitcoin.networks.regtest;
                break;
            default:
                throw new Error('Invalid network');
        }
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

    /*protected async createDefaultWallet(): Promise<void> {
        const params: CreateWalletParams = {
            wallet_name: this.defaultWalletName,
        };

        const wallet = await this.bitcoinRPC.createWallet(params);
        if (!wallet) {
            throw new Error('Failed to create wallet');
        }

        this.log(`Created wallet: ${wallet}`);
    }

    protected async getNewAddress(): Promise<void> {
        if (this.walletAddress) return;

        const address = await this.bitcoinRPC.getNewAddress('', this.defaultWalletName);
        if (!address) {
            throw new Error('Failed to get new address');
        }

        this.walletAddress = address;
    }

    private async getWalletAddress(): Promise<void> {
        if (this.walletAddress) return;

        const address: AddressByLabel | null = await this.bitcoinRPC.getAddressByLabel(
            '',
            this.defaultWalletName,
        );

        if (!address) {
            throw new Error('Failed to get new address');
        }

        this.walletAddress = Object.keys(address)[0];
    }

    private async listWallets(): Promise<void> {
        const wallets = await this.bitcoinRPC.listWallets();
        if (!wallets) {
            throw new Error('Failed to list wallets');
        }

        this.log(`Found wallets: ${wallets.join(', ')}`);
    }

    private async loadWallet(): Promise<void> {
        const wallet = await this.bitcoinRPC.loadWallet(this.defaultWalletName);

        if (!wallet) {
            return;
        }
    }

    private async getPrivateKey(): Promise<void> {
        const privateKey = await this.bitcoinRPC.dumpPrivateKey(
            this.walletAddress,
            this.defaultWalletName,
        );

        if (!privateKey) {
            throw new Error('Failed to get private key');
        }

        this.privateKey = privateKey;
        this.success(`Private key: ${this.privateKey}`);
    }

    private async importPrivateKey(): Promise<void> {
        if (!this.privateKey) {
            throw new Error('Private key not set');
        }

        await this.bitcoinRPC.importPrivateKey(
            this.privateKey,
            Math.random().toString(),
            false,
            this.defaultWalletName,
        );
    }

    private async getWallet(): Promise<void> {
        await this.loadWallet();
        await this.listWallets();
        await this.getWalletAddress();

        //await this.importPrivateKey();
        //await this.getWalletAddress();

        this.success(`Wallet loaded as ${this.walletAddress}`);
    }*/

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

    protected getNetworkString(): string {
        return Config.BLOCKCHAIN.BITCOIND_NETWORK.toLowerCase();
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

        // we get UXTOs after loading the wallet
        const lastTx = await this.mineBlock(1);
        if (!lastTx) throw new Error('Failed to get last transaction');

        this.lastTx = lastTx;
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

    public async init(): Promise<void> {
        this.log('Bitcoin core initializing...');

        await this.bitcoinRPC.init(Config.BLOCKCHAIN);
    }
}
