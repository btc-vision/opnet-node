import { Logger } from '@btc-vision/motoswapcommon';
import { CreateWalletParams } from 'rpc-bitcoin/build/src/rpc.js';
import { BitcoinRPC } from '../src/blockchain-indexer/rpc/BitcoinRPC.js';
import { AddressByLabel } from '../src/blockchain-indexer/rpc/types/AddressByLabel.js';
import { Config } from '../src/config/Config.js';

export abstract class BitcoinCore extends Logger {
    public readonly logColor: string = '#5dbcef';

    protected readonly defaultWalletName: string = 'default2';
    protected bitcoinRPC: BitcoinRPC = new BitcoinRPC();

    protected walletAddress: string = '';
    protected privateKey: string = '';

    protected constructor() {
        super();
    }

    protected async createDefaultWallet(): Promise<void> {
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
    }

    public async init(): Promise<void> {
        this.log('Bitcoin core initializing...');

        await this.bitcoinRPC.init(Config.BLOCKCHAIN);
        await this.getWallet();
    }
}
