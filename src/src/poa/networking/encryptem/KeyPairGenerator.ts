import crypto, { KeyPairSyncResult, Sign } from 'crypto';
import sodium from 'sodium-native';
import { P2PVersion, TRUSTED_PUBLIC_KEYS } from '../../configurations/P2PVersion.js';

export interface OPNetKeyPair {
    publicKey: Buffer;
    privateKey: Buffer;

    identity: OPNetProvenIdentity;
    rsa: {
        publicKey: string;
        privateKey: string;
    };
}

export type OPNetProvenIdentity = {
    hash: Buffer;
    proof: Buffer;
};

type SodiumKeyPair = {
    publicKey: Buffer;
    privateKey: Buffer;
};

export class KeyPairGenerator {
    private signatureAlgorithm: string = 'rsa-sha512';
    private trustedPublicKeys: string[] = [];

    private precomputedTrustedPublicKeys: { [key: string]: string } = {};

    constructor() {
        this.loadTrustedPublicKeys();
    }

    public generateKey(): OPNetKeyPair {
        const keyPair = this.generateKeyPair(this.generateAuthKey());
        const rsaKeyPair = this.generateRSAKeyPair(this.#passphrase(keyPair));

        const identity = this.generateIdentity(keyPair);

        return {
            publicKey: keyPair.publicKey,
            privateKey: keyPair.privateKey,
            identity: identity,
            rsa: {
                publicKey: rsaKeyPair.publicKey,
                privateKey: rsaKeyPair.privateKey,
            },
        };
    }

    public verifySignatureRSA(data: Buffer, signature: Buffer, publicKey: string): boolean {
        const verify = crypto.createVerify(this.signatureAlgorithm);
        verify.update(data);

        return verify.verify(
            {
                key: publicKey,
                padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
            },
            signature,
        );
    }

    public verifyOPNetIdentity(identity: string, pubKey: Buffer): boolean {
        const sha = crypto.createHash('sha512');
        sha.update(pubKey);

        const hash: Buffer = sha.digest();
        const hashStr = `0x${hash.toString('hex')}`;

        return hashStr === identity;
    }

    public opnetHash(data: Buffer): string {
        const hashed = this.hash(data);

        return `0x${hashed.toString('hex')}`;
    }

    public verifyChallenge(
        challenge: Buffer | Uint8Array,
        signature: Buffer | Uint8Array,
        pubKey: Buffer | Uint8Array,
    ): boolean {
        const hashedData: Buffer = this.hashWithPubKey(pubKey, challenge);

        return this.verifyOPNetSignature(hashedData, signature, pubKey);
    }

    public verifyOPNetSignature(
        data: Buffer,
        signature: Buffer | Uint8Array,
        pubKey: Buffer | Uint8Array,
    ): boolean {
        return sodium.crypto_sign_verify_detached(
            Buffer.from(signature.buffer, signature.byteOffset, signature.byteLength),
            data,
            Buffer.from(pubKey.buffer, pubKey.byteOffset, pubKey.byteLength),
        );
    }

    public verifyTrustedSignature(
        data: Buffer,
        signature: Buffer,
    ): { validity: boolean; identity: string } {
        for (const trustedPublicKey of this.trustedPublicKeys) {
            try {
                if (this.verifySignatureRSA(data, signature, trustedPublicKey)) {
                    return {
                        validity: true,
                        identity: this.precomputedTrustedPublicKeys[trustedPublicKey],
                    };
                }
            } catch (e) {}
        }

        return {
            validity: false,
            identity: '',
        };
    }

    public signRSA(data: Buffer, privateKey: string, keypair: SodiumKeyPair): Buffer {
        const signObj: Sign = this.getRSASignature(data);
        return signObj.sign({
            key: privateKey,
            padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
            passphrase: this.#passphrase(keypair),
        });
    }

    public hash(data: Buffer): Buffer {
        const hash = crypto.createHash('sha512');
        hash.update(data);

        return hash.digest();
    }

    public hashChallenge(keyPair: SodiumKeyPair, salt: Buffer | Uint8Array): Buffer {
        const result = this.hashWithPubKey(keyPair.publicKey, salt);

        return this.sign(result, keyPair.privateKey);
    }

    public sign(data: Buffer, privateKey: Buffer): Buffer {
        const signature = sodium.sodium_malloc(sodium.crypto_sign_BYTES);
        sodium.crypto_sign_detached(signature, data, privateKey);

        return signature;
    }

    private computeTrustedPublicKeys(): void {
        for (const trustedPublicKey of this.trustedPublicKeys) {
            this.precomputedTrustedPublicKeys[trustedPublicKey] = this.opnetHash(
                Buffer.from(trustedPublicKey.trim(), 'utf-8'),
            );
        }
    }

    private loadTrustedPublicKeys(): void {
        const currentVersion = TRUSTED_PUBLIC_KEYS[P2PVersion];
        if (!currentVersion) {
            throw new Error('Current version not found.');
        }

        if (currentVersion.length <= 0) {
            throw new Error('There is no trusted public keys for the current version.');
        }

        this.trustedPublicKeys = currentVersion.map((key) => key.trim());

        this.computeTrustedPublicKeys();
    }

    private hashWithPubKey(pubKey: Buffer | Uint8Array, data: Buffer | Uint8Array): Buffer {
        const hash = crypto.createHash('sha512');
        hash.update(pubKey);
        hash.update(data);

        return hash.digest();
    }

    #passphrase(keyPair: SodiumKeyPair): string {
        return Buffer.concat([keyPair.privateKey]).toString('hex');
    }

    private generateRSAKeyPair(passphrase: string): KeyPairSyncResult<string, string> {
        return crypto.generateKeyPairSync('rsa', {
            modulusLength: 4096,
            publicKeyEncoding: {
                type: 'spki',
                format: 'pem',
            },
            privateKeyEncoding: {
                type: 'pkcs8',
                format: 'pem',
                cipher: 'aes-256-cbc',
                passphrase: passphrase,
            },
        });
    }

    private generateAuthKey(): Buffer {
        const key = Buffer.alloc(32);

        return crypto.getRandomValues(key);
    }

    private generateIdentity(keypair: SodiumKeyPair): OPNetProvenIdentity {
        const sha = crypto.createHash('sha512');
        sha.update(keypair.publicKey);

        const hash: Buffer = sha.digest();
        const proof: Buffer = this.sign(hash, keypair.privateKey);

        return {
            hash,
            proof: proof,
        };
    }

    private getRSASignature(data: Buffer): Sign {
        const sign = crypto.createSign(this.signatureAlgorithm);
        sign.update(data);

        return sign;
    }

    private generateKeyPair(seed: Buffer): SodiumKeyPair {
        const publicKey = sodium.sodium_malloc(sodium.crypto_sign_PUBLICKEYBYTES);
        const privateKey = sodium.sodium_malloc(sodium.crypto_sign_SECRETKEYBYTES);
        sodium.crypto_sign_seed_keypair(publicKey, privateKey, seed);

        return {
            publicKey,
            privateKey,
        };
    }
}
