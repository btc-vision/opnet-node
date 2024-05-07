import { EcKeyPair } from '@btc-vision/bsi-transaction';
import { networks } from 'bitcoinjs-lib';
import { ECPairInterface } from 'ecpair';
import fs from 'fs';
import path from 'path';
import { BtcIndexerConfig } from '../../config/BtcIndexerConfig.js';
import { KeyPairGenerator, OPNetKeyPair } from '../networking/encryptem/KeyPairGenerator.js';
import { OPNetPathFinder } from './OPNetPathFinder.js';

export class OPNetIdentity extends OPNetPathFinder {
    private keyPairGenerator: KeyPairGenerator = new KeyPairGenerator();

    private readonly opnetAuthKeyBin: Uint8Array;
    private readonly opnetWallet: ECPairInterface;

    private readonly keyPair: OPNetKeyPair;

    public constructor(private readonly config: BtcIndexerConfig) {
        super();

        this.opnetWallet = this.loadOPNetWallet();
        this.deriveKey(this.opnetWallet.privateKey);

        this.opnetAuthKeyBin = this.loadOPNetAuthKeys();
        this.keyPair = this.restoreKeyPair(this.opnetAuthKeyBin);
    }

    public get tapAddress(): string {
        return EcKeyPair.getTaprootAddress(this.opnetWallet, this.network);
    }

    public get segwitAddress(): string {
        return EcKeyPair.getP2WPKHAddress(this.opnetWallet, this.network);
    }

    public get opnetAddress(): string {
        return '0x' + this.keyPair.identity.toString('hex');
    }

    public get opnetCertificate(): string {
        return this.convertToOPNetCertificate(this.opnetAuthKeyBin);
    }

    public get authKey(): Uint8Array {
        return this.opnetAuthKeyBin;
    }

    private get network(): networks.Network {
        switch (this.config.BLOCKCHAIN.BITCOIND_NETWORK) {
            case 'mainnet':
                return networks.bitcoin;
            case 'testnet':
                return networks.testnet;
            case 'regtest':
                return networks.regtest;
            default:
                throw new Error('Invalid network');
        }
    }

    private getOPNetAuthKeysPath(): string {
        return path.join(this.getBinPath(), 'opnet.bin');
    }

    private getOPNetWalletPath(): string {
        return path.join(this.getBinPath(), 'wallet.bin');
    }

    private loadOPNetAuthKeys(): Uint8Array {
        try {
            const lastKeys = fs.readFileSync(this.getOPNetAuthKeysPath());
            return this.decrypt(new Uint8Array(lastKeys));
        } catch (e) {
            const error = e as Error;
            if (error.message.includes('no such file or directory')) {
                return this.generateNewOPNetIdentity();
            }

            throw e;
        }
    }

    private generateNewOPNetWallet(): ECPairInterface {
        const wallet = EcKeyPair.generateRandomKeyPair(this.network);
        const wif = wallet.toWIF();

        // Fail-safe. If the wallet already exists, do not overwrite it.
        if (fs.existsSync(this.getOPNetWalletPath())) {
            throw new Error(
                `Wallet already exists. Cannot overwrite. Please delete the file found at ${this.getOPNetWalletPath()} and try again.`,
            );
        }

        fs.writeFileSync(this.getOPNetWalletPath(), this.encrypt(wif));

        return wallet;
    }

    private loadOPNetWallet(): ECPairInterface {
        try {
            const wallet = fs.readFileSync(this.getOPNetWalletPath());
            const decrypted = this.decryptToString(wallet);

            return EcKeyPair.fromWIF(decrypted, this.network);
        } catch (e) {
            const error = e as Error;
            if (error.message.includes('no such file or directory')) {
                return this.generateNewOPNetWallet();
            }

            throw e;
        }
    }

    private convertToOPNetCertificate(keypair: Buffer | Uint8Array): string {
        let out = `------BEGIN OPNET KEY-----\r\n`;
        out += Buffer.from(keypair).toString('base64') + '\r\n';
        out += `------END OPNET KEY-----`;

        return out;
    }

    private generateNewOPNetIdentity(): Uint8Array {
        const key = this.generateDefaultOPNetAuthKeys();

        if (fs.existsSync(this.getOPNetAuthKeysPath())) {
            throw new Error(
                `OPNet identity already exists. Cannot overwrite. Please delete the file found at ${this.getOPNetAuthKeysPath()} and try again.`,
            );
        }

        fs.writeFileSync(this.getOPNetAuthKeysPath(), this.encryptRaw(key));

        return key;
    }

    private restoreKeyPair(buf: Buffer | Uint8Array): OPNetKeyPair {
        const privateKey = buf.slice(0, 64);
        const publicKey = buf.slice(64, 96);
        const identity = buf.slice(96);

        return {
            privateKey: Buffer.from(privateKey),
            publicKey: Buffer.from(publicKey),
            identity: Buffer.from(identity),
        };
    }

    private generateDefaultOPNetAuthKeys(): Buffer {
        const keyPair = this.keyPairGenerator.generateKey(this.opnetWallet.publicKey);

        return Buffer.concat([keyPair.privateKey, keyPair.publicKey, keyPair.identity]);
    }
}
