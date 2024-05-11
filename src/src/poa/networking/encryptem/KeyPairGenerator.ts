import crypto, { KeyPairSyncResult } from 'crypto';
import sodium from 'sodium-native';
import { cyrb53 } from './CYRB53.js';

export interface OPNetKeyPair {
    publicKey: Buffer;
    privateKey: Buffer;

    identity: Buffer;
    rsa: {
        publicKey: string;
        privateKey: string;
    };
}

type SodiumKeyPair = {
    publicKey: Buffer;
    privateKey: Buffer;
};

export class KeyPairGenerator {
    public generateKey(bitcoinPubKey: Buffer): OPNetKeyPair {
        const keyPair = this.generateKeyPair(this.generateAuthKey());
        const rsaKeyPair = this.generateRSAKeyPair(
            Buffer.concat([keyPair.privateKey]).toString('hex'),
        );

        const identity = this.generateIdentity(keyPair, bitcoinPubKey, rsaKeyPair.privateKey);

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

    private generateIdentity(
        keypair: SodiumKeyPair,
        bitcoinPubKey: Buffer,
        rsaPrivKey: string,
    ): Buffer {
        const checksum = cyrb53(keypair.publicKey.toString('hex'), keypair.publicKey[10]);
        const bitcoinChecksum = cyrb53(bitcoinPubKey.toString('hex'), checksum);

        const sha = crypto.createHash('sha512');
        sha.update(keypair.publicKey);
        sha.update(rsaPrivKey);
        sha.update(keypair.privateKey);
        sha.update(new Uint32Array([checksum, bitcoinChecksum]));

        return sha.digest();
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
