import crypto from 'crypto';
import sodium from 'sodium-native';
import { Logger } from '@btc-vision/bsi-common';

export interface OPNetKeyPair {
    publicKey: Buffer;
    privateKey: Buffer;

    identity: OPNetProvenIdentity;
    trusted: SodiumKeyPair;
}

export type OPNetProvenIdentity = {
    hash: Buffer;
    proof: Buffer;
};

type SodiumKeyPair = {
    publicKey: Buffer;
    privateKey: Buffer;
};

export class KeyPairGenerator extends Logger {
    public readonly logColor: string = '#ffcc00';

    public constructor() {
        super();
    }

    public generateKey(): OPNetKeyPair {
        const keyPair: SodiumKeyPair = this.generateKeyPair(this.generateAuthKey());
        const trustedKeyPair: SodiumKeyPair = this.generateTrustedKeypair();

        const identity: OPNetProvenIdentity = this.generateIdentity(keyPair);

        return {
            publicKey: keyPair.publicKey,
            privateKey: keyPair.privateKey,
            identity: identity,
            trusted: trustedKeyPair,
        };
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

        if (!signature.byteLength) {
            throw new Error('Invalid signature.');
        }

        return signature;
    }

    public secureRandomBytes(length: number): Buffer {
        return crypto.randomBytes(length);
    }

    private hashWithPubKey(pubKey: Buffer | Uint8Array, data: Buffer | Uint8Array): Buffer {
        const hash = crypto.createHash('sha512');
        hash.update(pubKey);
        hash.update(data);

        return hash.digest();
    }

    private generateTrustedKeypair(): SodiumKeyPair {
        const seedBuffer: Buffer = crypto.randomBytes(sodium.crypto_sign_SEEDBYTES);

        const seed = sodium.sodium_malloc(sodium.crypto_sign_SEEDBYTES);
        sodium.randombytes_buf_deterministic(seed, seedBuffer);

        return this.generateKeyPair(seed);
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
