import { BitcoinNetwork } from '@btc-vision/bsi-common';
import { EcKeyPair } from '@btc-vision/bsi-transaction';
import { networks } from 'bitcoinjs-lib';
import { ECPairInterface } from 'ecpair';
import fs from 'fs';
import path from 'path';
import { BtcIndexerConfig } from '../../config/BtcIndexerConfig.js';
import { ChainIds } from '../../config/enums/ChainIds.js';
import { OPNetIndexerMode } from '../../config/interfaces/OPNetIndexerMode.js';
import { KeyPairGenerator, OPNetKeyPair } from '../networking/encryptem/KeyPairGenerator.js';
import { OPNetBlockWitness } from '../networking/protobuf/packets/blockchain/BlockHeaderWitness.js';
import { OPNetPathFinder } from './OPNetPathFinder.js';

export class OPNetIdentity extends OPNetPathFinder {
    private keyPairGenerator: KeyPairGenerator = new KeyPairGenerator();

    private readonly opnetAuthKeyBin: Uint8Array;
    private readonly opnetWallet: ECPairInterface;

    private readonly keyPair: OPNetKeyPair;
    private readonly rsaIdentity: string;

    public constructor(private readonly config: BtcIndexerConfig) {
        super();

        this.opnetWallet = this.loadOPNetWallet();
        this.deriveKey(this.opnetWallet.privateKey);

        this.opnetAuthKeyBin = this.loadOPNetAuthKeys();
        this.keyPair = this.restoreKeyPair(this.opnetAuthKeyBin);

        this.rsaIdentity = this.keyPairGenerator.opnetHash(
            Buffer.from(this.keyPair.rsa.publicKey.trim(), 'utf-8'),
        );
    }

    public get peerType(): number {
        const mode = this.config.OP_NET.MODE;

        switch (mode) {
            case OPNetIndexerMode.ARCHIVE:
                return 0;
            case OPNetIndexerMode.FULL:
                return 1;
            case OPNetIndexerMode.LIGHT:
                return 2;
            default:
                throw new Error('Invalid OPNet mode');
        }
    }

    public get peerNetwork(): number {
        const network = this.config.BLOCKCHAIN.BITCOIND_NETWORK;

        switch (network) {
            case BitcoinNetwork.Mainnet:
                return 0;
            case BitcoinNetwork.TestNet:
                return 1;
            case BitcoinNetwork.Regtest:
                return 2;
            case BitcoinNetwork.Signet:
                return 3;
            case BitcoinNetwork.Unknown:
                return 4;
            default:
                throw new Error('Invalid Bitcoin network');
        }
    }

    public get peerChainId(): ChainIds {
        return this.config.OP_NET.CHAIN_ID;
    }

    public get rsaPublicKey(): string {
        return this.keyPair.rsa.publicKey.trim();
    }

    public get tapAddress(): string {
        return EcKeyPair.getTaprootAddress(this.opnetWallet, this.network);
    }

    public get segwitAddress(): string {
        return EcKeyPair.getP2WPKHAddress(this.opnetWallet, this.network);
    }

    public get opnetAddress(): string {
        return '0x' + this.keyPair.identity.hash.toString('hex');
    }

    public get opnetAddressAsBuffer(): Buffer {
        return this.keyPair.identity.hash;
    }

    public get identityProof(): Buffer {
        return this.keyPair.identity.proof;
    }

    public get opnetCertificate(): string {
        return this.convertToOPNetCertificate(this.opnetAuthKeyBin);
    }

    public get authKey(): Uint8Array {
        if (!this.opnetAuthKeyBin) {
            throw new Error('OPNet Auth Key not found.');
        }

        return new Uint8Array(this.opnetAuthKeyBin);
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

    public hash(data: Buffer): Buffer {
        return this.keyPairGenerator.hash(data);
    }

    public identityChallenge(salt: Buffer | Uint8Array): Buffer {
        return this.keyPairGenerator.hashChallenge(this.keyPair, salt);
    }

    public verifyChallenge(
        challenge: Buffer | Uint8Array,
        signature: Buffer | Uint8Array,
        pubKey: Buffer | Uint8Array,
    ): boolean {
        return this.keyPairGenerator.verifyChallenge(challenge, signature, pubKey);
    }

    public verifyAcknowledgment(data: Buffer, witness: OPNetBlockWitness): boolean {
        if (!data) return false;
        if (!witness.opnetPubKey) return false;
        if (!witness.identity) return false;

        if (!this.verifyOPNetIdentity(witness.identity, witness.opnetPubKey)) return false;

        return this.keyPairGenerator.verifyOPNetSignature(
            data,
            witness.signature,
            witness.opnetPubKey,
        );
    }

    public verifyTrustedAcknowledgment(
        data: Buffer,
        witness: OPNetBlockWitness,
        identity: string | undefined,
    ): boolean {
        if (!data) return false;
        if (!witness.signature) return false;
        if (!identity) return false;

        // We protect the identity of trusted validators by not revealing their public keys.
        const validWitness = this.keyPairGenerator.verifyTrustedSignature(data, witness.signature);
        if (!validWitness.validity) return false;

        console.log(validWitness.identity, identity);

        return validWitness.identity === identity;
    }

    public verifyOPNetIdentity(identity: string, pubKey: Buffer): boolean {
        return this.keyPairGenerator.verifyOPNetIdentity(identity, pubKey);
    }

    public acknowledgeData(data: Buffer): OPNetBlockWitness {
        return {
            signature: this.keyPairGenerator.sign(data, this.keyPair.privateKey),
            identity: this.opnetAddress,
            opnetPubKey: this.keyPair.publicKey,
        };
    }

    public acknowledgeTrustedData(data: Buffer): OPNetBlockWitness {
        if (!this.opnetWallet.privateKey) throw new Error('Private key not found');

        return {
            signature: this.keyPairGenerator.signRSA(data, this.keyPair.rsa.privateKey, {
                privateKey: this.keyPair.privateKey,
                publicKey: this.keyPair.publicKey,
            }),
            identity: this.rsaIdentity,
        };
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

        const identity = buf.slice(96, 224);
        const rsaKey = Buffer.from(buf.slice(224));

        const regeneratedRsa = JSON.parse(rsaKey.toString('utf-8'));

        return {
            privateKey: Buffer.from(privateKey),
            publicKey: Buffer.from(publicKey),
            identity: {
                hash: Buffer.from(identity.slice(0, 64)),
                proof: Buffer.from(identity.slice(64)),
            },
            rsa: {
                privateKey: regeneratedRsa.privateKey,
                publicKey: regeneratedRsa.publicKey,
            },
        };
    }

    private generateDefaultOPNetAuthKeys(): Buffer {
        const keyPair = this.keyPairGenerator.generateKey();
        const rsaBuffer = Buffer.from(JSON.stringify(keyPair.rsa), `utf-8`);

        return Buffer.concat([
            keyPair.privateKey, // 64 bytes
            keyPair.publicKey, // 32 bytes
            keyPair.identity.hash, // 64 bytes
            keyPair.identity.proof, // 64 bytes
            rsaBuffer, // variable
        ]);
    }
}
