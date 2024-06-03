import { BitcoinNetwork, Logger } from '@btc-vision/bsi-common';
import {
    AuthorityBufferKey,
    AuthorityKey,
    NetworkAuthorityConfiguration,
    PrecomputedAuthorityKeys,
    ProvenAuthorityKeysAsBytes,
    TrustedNetworkPublicKeys,
} from '../types/TrustedPublicKeys.js';
import { TrustedCompanies } from '../TrustedCompanies.js';
import { P2PVersion, TRUSTED_PUBLIC_KEYS } from '../P2PVersion.js';
import { ChainIds } from '../../../config/enums/ChainIds.js';
import { KeyPairGenerator } from '../../networking/encryptem/KeyPairGenerator.js';
import { TrustedVersion } from '../version/TrustedVersion.js';

export type TrustedPublicKeys = {
    [key in TrustedCompanies]: Buffer[];
};

export class TrustedAuthority extends Logger {
    public readonly logColor: string = '#5dbcef';

    private trustedKeys: Partial<ProvenAuthorityKeysAsBytes> = {};
    private precomputedTrustedPublicKeys: Partial<PrecomputedAuthorityKeys> = {};

    private readonly authorityConfig: NetworkAuthorityConfiguration;

    private readonly publicKeys: TrustedPublicKeys;

    private keypairGenerator: KeyPairGenerator = new KeyPairGenerator();

    constructor(
        public readonly version: TrustedVersion,
        public readonly chainId: ChainIds,
        public readonly network: BitcoinNetwork,
    ) {
        super();

        this.authorityConfig = this.getAuthorityConfig();

        this.loadTrustedPublicKeys();
        this.publicKeys = this.getTrustedPublicKeys();
    }

    public get trustedCompanies(): TrustedCompanies[] {
        return Object.keys(this.trustedKeys) as TrustedCompanies[];
    }

    public get trustedPublicKeys(): TrustedPublicKeys {
        return this.publicKeys;
    }

    public get minimum(): number {
        return this.authorityConfig.minimum;
    }

    public get transactionMinimum(): number {
        return this.authorityConfig.transactionMinimum;
    }

    public get maximumValidatorPerTrustedEntities(): number {
        return this.authorityConfig.maximumValidatorPerTrustedEntities;
    }

    public get trustedPublicKeysRespectingConstraints(): TrustedPublicKeys {
        const trustedPublicKeys: Partial<TrustedPublicKeys> = {};
        const maximumValidatorPerTrustedEntities = this.maximumValidatorPerTrustedEntities;

        for (const trustedCompany in this.trustedKeys) {
            const trustedPublicKeysForCompany =
                this.trustedKeys[trustedCompany as TrustedCompanies];
            if (!trustedPublicKeysForCompany) continue;

            const keys: Buffer[] = trustedPublicKeysForCompany.keys.map(
                (key: AuthorityBufferKey) => {
                    return key.publicKey;
                },
            );

            if (keys.length === 0) continue;
            const shuffledPublicKeys: Buffer[] = this.shuffleArray(keys);

            // Now we need to remove keys so that the number of keys is less than or equal to the maximumValidatorPerTrustedEntities
            const shuffledPublicKeysLength = shuffledPublicKeys.length;
            const keysToRemove: number =
                shuffledPublicKeysLength - maximumValidatorPerTrustedEntities;

            if (keysToRemove > 0) {
                shuffledPublicKeys.splice(0, keysToRemove);
            }

            trustedPublicKeys[trustedCompany as TrustedCompanies] = shuffledPublicKeys;
        }

        return trustedPublicKeys as TrustedPublicKeys;
    }

    public verifyPublicKeysConstraints(publicKeys: Buffer[]): boolean {
        // we need to verify that the public keys are less than or equal to the maximumValidatorPerTrustedEntities for each trusted company
        let differentTrustedKeysInList: number = 0;
        for (const trustedCompany in this.trustedKeys) {
            const trustedPublicKeysForCompany =
                this.trustedKeys[trustedCompany as TrustedCompanies];
            if (!trustedPublicKeysForCompany) continue;

            const keys: Buffer[] = trustedPublicKeysForCompany.keys.map(
                (key: AuthorityBufferKey) => {
                    return key.publicKey;
                },
            );

            if (keys.length === 0) continue;

            const matchingKeys: Buffer[] = publicKeys.filter((publicKey: Buffer) => {
                return keys.includes(publicKey);
            });

            if (matchingKeys.length > this.maximumValidatorPerTrustedEntities) {
                return false;
            }

            if (matchingKeys.length !== 0) {
                differentTrustedKeysInList++;
            }
        }

        // we need to verify that the public keys are greater than or equal to the minimum number of trusted keys
        if (differentTrustedKeysInList < this.minimum) {
            return false;
        }

        return differentTrustedKeysInList >= this.transactionMinimum;
    }

    public verifyTrustedSignature(
        data: Buffer,
        signature: Buffer,
    ): { validity: boolean; identity: string } {
        for (const trustedPublicKeyCompany in this.trustedKeys) {
            const trustedPublicKeys = this.trustedKeys[trustedPublicKeyCompany as TrustedCompanies];

            const precomputedTrustedPublicKeysForCompany =
                this.precomputedTrustedPublicKeys[trustedPublicKeyCompany as TrustedCompanies];

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

    private shuffleArray(array: Buffer[]): Buffer[] {
        const shuffledArray = [...array];

        for (let i = shuffledArray.length - 1; i > 0; i--) {
            const rnd = this.keypairGenerator.secureRandomBytes(1);
            const j = Math.floor((rnd[0] / 255) * (i + 1));
            [shuffledArray[i], shuffledArray[j]] = [shuffledArray[j], shuffledArray[i]];
        }

        return shuffledArray;
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

    private getTrustedPublicKeys(): TrustedPublicKeys {
        const publicKeys: Partial<TrustedPublicKeys> = {};

        for (const trustedCompany in this.trustedKeys) {
            const trustedPublicKeys = this.trustedKeys[trustedCompany as TrustedCompanies];
            if (!trustedPublicKeys) continue;

            publicKeys[trustedCompany as TrustedCompanies] = trustedPublicKeys.keys.map(
                (key: AuthorityBufferKey) => {
                    return key.publicKey;
                },
            );
        }

        return publicKeys as TrustedPublicKeys;
    }

    private computeTrustedPublicKeys(): void {
        for (const trustedPublicKey in this.trustedKeys) {
            const trustedPublicKeys = this.trustedKeys[trustedPublicKey as TrustedCompanies];

            if (!trustedPublicKeys) continue;

            const precomputedTrustedPublicKeys: string[] = trustedPublicKeys.keys.map(
                (key: AuthorityBufferKey) => {
                    return this.keypairGenerator.opnetHash(key.opnet);
                },
            );

            this.precomputedTrustedPublicKeys[trustedPublicKey as TrustedCompanies] = {
                keys: precomputedTrustedPublicKeys,
            };
        }
    }

    private loadTrustedPublicKeys(): void {
        for (const trustedCompany in this.authorityConfig.trusted) {
            const trustedKeys = this.authorityConfig.trusted[trustedCompany as TrustedCompanies];
            if (!trustedKeys) continue;

            const keys: AuthorityBufferKey[] = trustedKeys.keys
                .filter((key: AuthorityKey) => {
                    return key.publicKey.length > 0 && key.opnet.length > 0;
                })
                .map((key: AuthorityKey): AuthorityBufferKey => {
                    return {
                        publicKey: Buffer.from(key.publicKey, 'base64'),
                        opnet: Buffer.from(key.opnet, 'base64'),
                        signature: Buffer.from(key.signature, 'base64'),
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

            this.trustedKeys[trustedCompany as TrustedCompanies] = {
                keys: keys,
            };

            this.log(`Loaded ${keys.length} trusted keys for ${trustedCompany}`);
        }

        if (Object.keys(this.trustedKeys).length === 0) {
            throw new Error('[FAILED TO LOAD] No trusted keys found for current network version.');
        }

        this.computeTrustedPublicKeys();
    }
}
