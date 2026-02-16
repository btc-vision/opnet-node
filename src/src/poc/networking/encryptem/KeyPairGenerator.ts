import crypto from 'crypto';
import sodium from 'sodium-native';
import { Logger } from '@btc-vision/bsi-common';
import { toHex } from '@btc-vision/bitcoin';

export interface OPNetKeyPair {
    publicKey: Uint8Array;
    privateKey: Uint8Array;

    identity: OPNetProvenIdentity;
    trusted: SodiumKeyPair;
}

export type OPNetProvenIdentity = {
    hash: Uint8Array;
    proof: Uint8Array;
};

type SodiumKeyPair = {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
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

    public verifyOPNetIdentity(identity: string, pubKey: Uint8Array): boolean {
        const sha = crypto.createHash('sha512');
        sha.update(pubKey);

        const hash = sha.digest();
        const hashStr = `0x${toHex(hash)}`;

        return hashStr === identity;
    }

    public opnetHash(data: Uint8Array): string {
        const hashed = this.hash(data);

        return `0x${toHex(hashed)}`;
    }

    public verifyChallenge(
        challenge: Uint8Array,
        signature: Uint8Array,
        pubKey: Uint8Array,
    ): boolean {
        const hashedData: Uint8Array = this.hashWithPubKey(pubKey, challenge);

        return this.verifyOPNetSignature(hashedData, signature, pubKey);
    }

    public verifyOPNetSignature(
        data: Uint8Array,
        signature: Uint8Array,
        pubKey: Uint8Array,
    ): boolean {
        return sodium.crypto_sign_verify_detached(
            Buffer.from(signature.buffer, signature.byteOffset, signature.byteLength),
            Buffer.from(data.buffer, data.byteOffset, data.byteLength),
            Buffer.from(pubKey.buffer, pubKey.byteOffset, pubKey.byteLength),
        );
    }

    public hash(data: Uint8Array): Uint8Array {
        const hash = crypto.createHash('sha512');
        hash.update(data);

        return hash.digest();
    }

    public hashChallenge(keyPair: SodiumKeyPair, salt: Uint8Array): Uint8Array {
        const result = this.hashWithPubKey(keyPair.publicKey, salt);

        return this.sign(result, keyPair.privateKey);
    }

    public sign(data: Uint8Array, privateKey: Uint8Array): Uint8Array {
        const signature = sodium.sodium_malloc(sodium.crypto_sign_BYTES);
        sodium.crypto_sign_detached(
            signature,
            Buffer.from(data.buffer, data.byteOffset, data.byteLength),
            Buffer.from(privateKey.buffer, privateKey.byteOffset, privateKey.byteLength),
        );

        if (!signature.byteLength) {
            throw new Error('Invalid signature.');
        }

        return signature;
    }

    public secureRandomBytes(length: number): Uint8Array {
        return crypto.randomBytes(length);
    }

    private hashWithPubKey(pubKey: Uint8Array, data: Uint8Array): Uint8Array {
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

    private generateAuthKey(): Uint8Array {
        const key = Buffer.alloc(32);

        return crypto.getRandomValues(key);
    }

    private generateIdentity(keypair: SodiumKeyPair): OPNetProvenIdentity {
        const sha = crypto.createHash('sha512');
        sha.update(keypair.publicKey);

        const hash: Buffer = sha.digest();
        const proof: Uint8Array = this.sign(hash, keypair.privateKey);

        return {
            hash,
            proof: proof,
        };
    }

    private generateKeyPair(seed: Uint8Array): SodiumKeyPair {
        const publicKey = sodium.sodium_malloc(sodium.crypto_sign_PUBLICKEYBYTES);
        const privateKey = sodium.sodium_malloc(sodium.crypto_sign_SECRETKEYBYTES);
        sodium.crypto_sign_seed_keypair(
            publicKey,
            privateKey,
            Buffer.from(seed.buffer, seed.byteOffset, seed.byteLength),
        );

        return {
            publicKey,
            privateKey,
        };
    }
}
