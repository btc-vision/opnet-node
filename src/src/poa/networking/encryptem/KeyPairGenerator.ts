import crypto from 'crypto';
import sodium from 'sodium-native';
import { cyrb53 } from './CYRB53.js';

export interface OPNetKeyPair {
    publicKey: Buffer;
    privateKey: Buffer;

    identity: Buffer;
}

export class KeyPairGenerator {
    public generateKey(bitcoinPubKey: Buffer): OPNetKeyPair {
        const keyPair = this.generateKeyPair(this.generateAuthKey());
        const identity = this.generateIdentity(keyPair.publicKey, bitcoinPubKey);

        return {
            publicKey: keyPair.publicKey,
            privateKey: keyPair.privateKey,
            identity: identity,
        };
    }

    private generateAuthKey(): Buffer {
        const key = Buffer.alloc(32);

        return crypto.getRandomValues(key);
    }

    private generateIdentity(OPNetPublicKey: Buffer, bitcoinPubKey: Buffer): Buffer {
        const checksum = cyrb53(OPNetPublicKey.toString('hex'), OPNetPublicKey[10]);
        const bitcoinChecksum = cyrb53(bitcoinPubKey.toString('hex'), checksum);

        const sha = crypto.createHash('sha512');
        sha.update(bitcoinPubKey);
        sha.update(OPNetPublicKey);
        sha.update(new Uint32Array([checksum, bitcoinChecksum]));

        return sha.digest();
    }

    private generateKeyPair(seed: Buffer) {
        const publicKey = sodium.sodium_malloc(sodium.crypto_sign_PUBLICKEYBYTES);
        const privateKey = sodium.sodium_malloc(sodium.crypto_sign_SECRETKEYBYTES);
        sodium.crypto_sign_seed_keypair(publicKey, privateKey, seed);

        return {
            publicKey,
            privateKey,
        };
    }
}
