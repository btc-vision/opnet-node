import { fromBase64, fromHex, toBase64 } from '@btc-vision/bitcoin';
import { Logger } from '@btc-vision/bsi-common';
import {
    AuthorityBufferKey,
    AuthorityKey,
    NetworkAuthorityConfiguration,
    PrecomputedAuthorityKeys,
    ProvenAuthorityKeysAsBytes,
    TrustedNetworkPublicKeys,
} from '../types/TrustedPublicKeys.js';
import { TrustedEntities } from '../TrustedEntities.js';
import { P2PVersion, TRUSTED_PUBLIC_KEYS } from '../P2PVersion.js';
import { ChainIds } from '../../../config/enums/ChainIds.js';
import { KeyPairGenerator } from '../../networking/encryptem/KeyPairGenerator.js';
import { TrustedVersion } from '../version/TrustedVersion.js';

import { BitcoinNetwork } from '../../../config/network/BitcoinNetwork.js';
import { Address } from '@btc-vision/transaction';
import crypto from 'crypto';

export function shuffleArray<T>(array: T[]): T[] {
    const shuffledArray = array.slice();

    // Use Fisher-Yates (Knuth) shuffle algorithm
    for (let i = shuffledArray.length - 1; i > 0; i--) {
        const j = Math.floor(
            (crypto.getRandomValues(new Uint32Array(1))[0] / (0xffffffff + 1)) * (i + 1),
        );

        [shuffledArray[i], shuffledArray[j]] = [shuffledArray[j], shuffledArray[i]];
    }

    return shuffledArray;
}

export class TrustedAuthority extends Logger {
    public readonly logColor: string = '#5dbcef';

    private trustedKeys: Partial<ProvenAuthorityKeysAsBytes> = {};
    private precomputedTrustedPublicKeys: Partial<PrecomputedAuthorityKeys> = {};

    private readonly authorityConfig: NetworkAuthorityConfiguration;

    private keypairGenerator: KeyPairGenerator = new KeyPairGenerator();

    constructor(
        public readonly version: TrustedVersion,
        public readonly chainId: ChainIds,
        public readonly network: BitcoinNetwork,
    ) {
        super();

        this.authorityConfig = this.getAuthorityConfig();
        this.loadTrustedPublicKeys();
    }

    public get minimum(): number {
        return this.authorityConfig.minimum;
    }

    public get transactionMinimum(): number {
        return this.authorityConfig.transactionMinimum;
    }

    public verifyTrustedSignature(
        data: Uint8Array,
        signature: Uint8Array,
    ): { validity: boolean; identity: string } {
        for (const trustedPublicKeyCompany in this.trustedKeys) {
            const trustedPublicKeys = this.trustedKeys[trustedPublicKeyCompany as TrustedEntities];

            const precomputedTrustedPublicKeysForCompany =
                this.precomputedTrustedPublicKeys[trustedPublicKeyCompany as TrustedEntities];

            if (!trustedPublicKeys || !precomputedTrustedPublicKeysForCompany) continue;

            for (let i = 0; i < trustedPublicKeys.keys.length; i++) {
                const trustedPublicKey = trustedPublicKeys.keys[i];

                try {
                    if (
                        this.keypairGenerator.verifyOPNetSignature(
                            data,
                            signature,
                            trustedPublicKey.opnet,
                        )
                    ) {
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

    private getAuthorityConfig(): NetworkAuthorityConfiguration {
        const currentVersion = TRUSTED_PUBLIC_KEYS[P2PVersion];
        if (!currentVersion) {
            throw new Error('Current version not found.');
        }

        const currentNetwork: Partial<TrustedNetworkPublicKeys> = currentVersion[this.chainId];
        if (!currentNetwork) throw new Error('Current network not found.');

        const currentNetworkVersion: NetworkAuthorityConfiguration | undefined =
            currentNetwork[this.network];

        if (!currentNetworkVersion) {
            throw new Error('Trusted key for current network version not found.');
        }

        if (Object.keys(currentNetworkVersion.trusted).length === 0) {
            throw new Error('No trusted keys found for current network version.');
        }

        return currentNetworkVersion;
    }

    private computeTrustedPublicKeys(): void {
        for (const trustedPublicKey in this.trustedKeys) {
            const trustedPublicKeys = this.trustedKeys[trustedPublicKey as TrustedEntities];

            if (!trustedPublicKeys) continue;

            const precomputedTrustedPublicKeys: string[] = trustedPublicKeys.keys.map(
                (key: AuthorityBufferKey) => {
                    return this.keypairGenerator.opnetHash(key.opnet);
                },
            );

            this.precomputedTrustedPublicKeys[trustedPublicKey as TrustedEntities] = {
                keys: precomputedTrustedPublicKeys,
            };
        }
    }

    private loadTrustedPublicKeys(): void {
        for (const trustedCompany in this.authorityConfig.trusted) {
            const trustedKeys = this.authorityConfig.trusted[trustedCompany as TrustedEntities];
            if (!trustedKeys) continue;

            const keys: AuthorityBufferKey[] = trustedKeys.keys
                .filter((key: AuthorityKey) => {
                    return key.publicKey.length > 0 && key.opnet.length > 0;
                })
                .map((key: AuthorityKey): AuthorityBufferKey => {
                    return {
                        publicKey: fromBase64(key.publicKey),
                        opnet: fromBase64(key.opnet),
                        signature: fromBase64(key.signature),
                        wallet: new Address(
                            fromHex(
                                key.mldsaPublicKey.startsWith('0x')
                                    ? key.mldsaPublicKey.slice(2)
                                    : key.mldsaPublicKey,
                            ),
                            fromHex(
                                key.walletPubKey.startsWith('0x')
                                    ? key.walletPubKey.slice(2)
                                    : key.walletPubKey,
                            ),
                        ),
                    };
                })
                .filter((key: AuthorityBufferKey) => {
                    // verify signature of the key
                    return this.keypairGenerator.verifyOPNetSignature(
                        key.publicKey,
                        key.signature,
                        key.opnet,
                    );
                });

            if (keys.length === 0) continue;

            this.trustedKeys[trustedCompany as TrustedEntities] = {
                keys: keys,
            };

            this.log(`Loaded ${keys.length} trusted keys for ${trustedCompany}`);
        }

        // We must verify that there is no duplicate key between the different trusted companies and themself
        const allKeys: string[] = [];
        for (const trustedCompany in this.trustedKeys) {
            const trustedPublicKeys = this.trustedKeys[trustedCompany as TrustedEntities];
            if (!trustedPublicKeys) continue;

            for (let i = 0; i < trustedPublicKeys.keys.length; i++) {
                const key = trustedPublicKeys.keys[i];
                const keyHash = this.keypairGenerator.opnetHash(key.opnet);

                if (allKeys.includes(keyHash)) {
                    throw new Error(
                        `Duplicate key found for ${trustedCompany} -> ${toBase64(key.opnet)}`,
                    );
                }

                allKeys.push(keyHash);
            }
        }

        if (Object.keys(this.trustedKeys).length === 0) {
            throw new Error('[FAILED TO LOAD] No trusted keys found for current network version.');
        }

        this.computeTrustedPublicKeys();
    }
}
