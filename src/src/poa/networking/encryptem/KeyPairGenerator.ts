import crypto from 'crypto';
import sodium from 'sodium-native';
import { P2PVersion, TRUSTED_PUBLIC_KEYS } from '../../configurations/P2PVersion.js';
import { ChainIds } from '../../../config/enums/ChainIds';
import { BitcoinNetwork, Logger } from '@btc-vision/bsi-common';
import {
    ProvenAuthorityKeys,
    ProvenAuthorityKeysAsBytes,
    TrustedNetworkPublicKeys,
} from '../../configurations/types/TrustedPublicKeys.js';
import { TrustedCompanies } from '../../configurations/TrustedCompanies.js';

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

    private trustedPublicKeys: Partial<ProvenAuthorityKeysAsBytes> = {};

    private precomputedTrustedPublicKeys: Partial<ProvenAuthorityKeys> = {};

    constructor(
        private readonly chainId: ChainIds,
        private readonly network: BitcoinNetwork,
    ) {
        super();

        this.loadTrustedPublicKeys();
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

    public verifyTrustedSignature(
        data: Buffer,
        signature: Buffer,
    ): { validity: boolean; identity: string } {
        for (const trustedPublicKeyCompany in this.trustedPublicKeys) {
            const trustedPublicKeys =
                this.trustedPublicKeys[trustedPublicKeyCompany as TrustedCompanies];

            const precomputedTrustedPublicKeysForCompany =
                this.precomputedTrustedPublicKeys[trustedPublicKeyCompany as TrustedCompanies];

            if (!trustedPublicKeys || !precomputedTrustedPublicKeysForCompany) continue;

            for (let i = 0; i < trustedPublicKeys.keys.length; i++) {
                const trustedPublicKey = trustedPublicKeys.keys[i];

                try {
                    if (this.verifyOPNetSignature(data, signature, trustedPublicKey)) {
                        const precomputedKey: string =
                            precomputedTrustedPublicKeysForCompany.keys[i];

                        return {
                            validity: true,
                            identity: precomputedKey,
                        };
                    }
                } catch (e) {}
            }
        }

        return {
            validity: false,
            identity: '',
        };
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
        for (const trustedPublicKey in this.trustedPublicKeys) {
            const trustedPublicKeys = this.trustedPublicKeys[trustedPublicKey as TrustedCompanies];

            if (!trustedPublicKeys) continue;

            const precomputedTrustedPublicKeys: string[] = trustedPublicKeys.keys.map(
                (key: Buffer) => {
                    return this.opnetHash(key);
                },
            );

            this.precomputedTrustedPublicKeys[trustedPublicKey as TrustedCompanies] = {
                keys: precomputedTrustedPublicKeys,
            };
        }
    }

    private loadTrustedPublicKeys(): void {
        const currentVersion = TRUSTED_PUBLIC_KEYS[P2PVersion];
        if (!currentVersion) {
            throw new Error('Current version not found.');
        }

        const currentNetwork: Partial<TrustedNetworkPublicKeys> = currentVersion[this.chainId];
        if (!currentNetwork) throw new Error('Current network not found.');

        const currentNetworkVersion: Partial<ProvenAuthorityKeys> | undefined =
            currentNetwork[this.network];

        if (!currentNetworkVersion) {
            throw new Error('Trusted key for current network version not found.');
        }

        if (Object.keys(currentNetworkVersion).length === 0) {
            throw new Error('No trusted keys found for current network version.');
        }

        for (const trustedCompany in currentNetworkVersion) {
            const trustedKeys = currentNetworkVersion[trustedCompany as TrustedCompanies];
            if (!trustedKeys) continue;

            const keys: Buffer[] = trustedKeys.keys
                .filter((key: string) => {
                    return key.length > 0;
                })
                .map((key: string) => {
                    return Buffer.from(key, 'base64');
                });

            if (keys.length === 0) continue;

            this.trustedPublicKeys[trustedCompany as TrustedCompanies] = {
                keys: keys,
            };

            this.log(`Loaded ${keys.length} trusted keys for ${trustedCompany}`);
        }

        if (Object.keys(this.trustedPublicKeys).length === 0) {
            throw new Error('No trusted keys found for current network version.');
        }

        this.computeTrustedPublicKeys();
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
