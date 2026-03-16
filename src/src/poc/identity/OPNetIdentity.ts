import { concat, Network, Signer, toBase64, toHex, toXOnly } from '@btc-vision/bitcoin';
import { UniversalSigner } from '@btc-vision/ecpair';
import fs from 'fs';
import path from 'path';
import { BtcIndexerConfig } from '../../config/BtcIndexerConfig.js';
import { ChainIds } from '../../config/enums/ChainIds.js';
import { OPNetIndexerMode } from '../../config/interfaces/OPNetIndexerMode.js';
import { KeyPairGenerator, OPNetKeyPair } from '../networking/encryptem/KeyPairGenerator.js';
import { OPNetBlockWitness } from '../networking/protobuf/packets/blockchain/common/BlockHeaderWitness.js';
import { OPNetPathFinder } from './OPNetPathFinder.js';
import { EcKeyPair } from '@btc-vision/transaction';
import { NetworkConverter } from '../../config/network/NetworkConverter.js';
import Long from 'long';

export class OPNetIdentity extends OPNetPathFinder {
    public readonly network: Network = NetworkConverter.getNetwork();

    private keyPairGenerator: KeyPairGenerator;

    private readonly opnetAuthKeyBin: Uint8Array;
    private readonly opnetWallet: UniversalSigner;

    private readonly keyPair: OPNetKeyPair;

    readonly #xPubKey: Uint8Array;

    private readonly opnetWalletPubKeyBytes: Uint8Array;

    public constructor(
        private readonly config: BtcIndexerConfig,
    ) {
        super();

        this.keyPairGenerator = new KeyPairGenerator();

        this.opnetWallet = this.loadOPNetWallet();
        this.deriveKey(this.opnetWallet.privateKey);

        this.opnetWalletPubKeyBytes = new Uint8Array(this.opnetWallet.publicKey);

        this.opnetAuthKeyBin = this.loadOPNetAuthKeys();
        this.keyPair = this.restoreKeyPair(this.opnetAuthKeyBin);

        this.#xPubKey = toXOnly(this.opnetWallet.publicKey);
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
                throw new Error(`Invalid indexer mode: ${mode}`);
        }
    }

    public get peerChainId(): ChainIds {
        return this.config.BITCOIN.CHAIN_ID;
    }

    public get opnetPubKey(): string {
        return toBase64(this.keyPair.publicKey);
    }

    public get pubKeyBase64(): string {
        return toBase64(this.publicKey);
    }

    public get xPubKey(): Uint8Array {
        return this.#xPubKey;
    }

    public get publicKey(): Uint8Array {
        return this.opnetWalletPubKeyBytes;
    }

    public get tapAddress(): string {
        return EcKeyPair.getTaprootAddress(this.opnetWallet, this.network);
    }

    public get segwitAddress(): string {
        return EcKeyPair.getP2WPKHAddress(this.opnetWallet, this.network);
    }

    public get pubKey(): string {
        return '0x' + toHex(this.opnetWallet.publicKey);
    }

    public get opnetAddress(): string {
        return '0x' + toHex(this.keyPair.identity.hash);
    }

    public get opnetAddressAsBuffer(): Uint8Array {
        return this.keyPair.identity.hash;
    }

    public get authKey(): Uint8Array {
        if (!this.opnetAuthKeyBin) {
            throw new Error('OPNet Auth Key not found.');
        }

        return new Uint8Array(this.opnetAuthKeyBin);
    }

    public get peerNetwork(): number {
        return NetworkConverter.peerNetwork;
    }

    public getSigner(): Signer | UniversalSigner {
        return this.opnetWallet;
    }

    public hash(data: Uint8Array): Uint8Array {
        return this.keyPairGenerator.hash(data);
    }

    public identityChallenge(salt: Uint8Array): Uint8Array {
        return this.keyPairGenerator.hashChallenge(this.keyPair, salt);
    }

    public verifyChallenge(
        challenge: Uint8Array,
        signature: Uint8Array,
        pubKey: Uint8Array,
    ): boolean {
        return this.keyPairGenerator.verifyChallenge(challenge, signature, pubKey);
    }

    // PoC: Proof of Computational Acknowledgment
    public verifyAcknowledgment(data: Uint8Array, witness: OPNetBlockWitness): boolean {
        if (!data) return false;
        if (!witness.publicKey) return false;
        if (!witness.identity) return false;

        if (!this.verifyOPNetIdentity(witness.identity, witness.publicKey)) return false;

        return this.keyPairGenerator.verifyOPNetSignature(
            data,
            witness.signature,
            witness.publicKey,
        );
    }

    public verifyOPNetIdentity(identity: string, pubKey: Uint8Array): boolean {
        return this.keyPairGenerator.verifyOPNetIdentity(identity, pubKey);
    }

    public acknowledgeData(data: Uint8Array): OPNetBlockWitness {
        const now = BigInt(Date.now());
        const witnessData = this.mergeDataAndWitness(data, now);

        return {
            signature: this.keyPairGenerator.sign(witnessData, this.keyPair.privateKey),
            timestamp: Long.fromBigInt(now, true),
            identity: this.opnetAddress,
            publicKey: this.keyPair.publicKey,
        };
    }

    public mergeDataAndWitness(blockChecksumHash: Uint8Array, timestamp: bigint): Uint8Array {
        const data = new Uint8Array(40);
        data.set(blockChecksumHash.subarray(0, 32), 0);
        const view = new DataView(data.buffer);
        view.setBigUint64(32, timestamp, false);

        return data;
    }

    private getOPNetAuthKeysPath(): string {
        return path.join(this.getBinPath(), `opnet.bin`);
    }

    private getOPNetWalletPath(): string {
        return path.join(this.getBinPath(), `wallet.bin`);
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

    private generateNewOPNetWallet(): UniversalSigner {
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

    private loadOPNetWallet(): UniversalSigner {
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

    private generateNewOPNetIdentity(): Uint8Array {
        const key: Uint8Array = this.generateDefaultOPNetAuthKeys();

        if (fs.existsSync(this.getOPNetAuthKeysPath())) {
            throw new Error(
                `OPNet identity already exists. Cannot overwrite. Please delete the file found at ${this.getOPNetAuthKeysPath()} and try again.`,
            );
        }

        fs.writeFileSync(this.getOPNetAuthKeysPath(), this.encryptRaw(key));

        return key;
    }

    private restoreKeyPair(buf: Uint8Array): OPNetKeyPair {
        const privateKey = buf.subarray(0, 64);
        const publicKey = buf.subarray(64, 96);

        const identity = buf.subarray(96, 224);

        return {
            privateKey: new Uint8Array(privateKey),
            publicKey: new Uint8Array(publicKey),
            identity: {
                hash: new Uint8Array(identity.subarray(0, 64)),
                proof: new Uint8Array(identity.subarray(64)),
            },
        };
    }

    private generateDefaultOPNetAuthKeys(): Uint8Array {
        const keyPair = this.keyPairGenerator.generateKey();

        return concat([
            keyPair.privateKey, // 64 bytes
            keyPair.publicKey, // 32 bytes
            keyPair.identity.hash, // 64 bytes
            keyPair.identity.proof, // 64 bytes
        ]);
    }
}
