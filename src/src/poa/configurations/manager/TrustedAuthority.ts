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

/*export type TrustedPublicKeys = {
    [key in TrustedEntities]: Buffer[];
};

export interface TrustedPublicKeysWithConstraints {
    readonly keys: Buffer[];
    readonly entities: TrustedEntities[];

    readonly constraints: {
        readonly minimum: number;
        readonly minimumSignatureRequired: number;
    };
}

export interface PublicAuthorityKey {
    key: Buffer;
    authority: TrustedEntities;
}*/

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
    //private readonly publicKeys: TrustedPublicKeys;

    private keypairGenerator: KeyPairGenerator = new KeyPairGenerator();

    //private readonly wbtcContractAddresses: string[];
    //private readonly wbtcDeployer: Address;

    constructor(
        public readonly version: TrustedVersion,
        public readonly chainId: ChainIds,
        public readonly network: BitcoinNetwork,
    ) {
        super();

        this.authorityConfig = this.getAuthorityConfig();
        //const deploymentInfo = this.getWBTCDeploymentInfo();

        //this.wbtcContractAddresses = deploymentInfo.addresses;
        //this.wbtcDeployer = deploymentInfo.deployer;

        this.loadTrustedPublicKeys();
        //this.publicKeys = this.getTrustedPublicKeys();
    }

    /*public get WBTC_CONTRACT_ADDRESSES(): string[] {
        return this.wbtcContractAddresses;
    }

    public get WBTC_SEGWIT_CONTRACT_ADDRESS(): string {
        const address = this.wbtcContractAddresses[0];

        if (!address) {
            throw new Error('WBTC segwit contract address not found');
        }

        return address;
    }

    public get WBTC_DEPLOYER(): Address {
        return this.wbtcDeployer;
    }

    public get trustedCompanies(): TrustedEntities[] {
        return Object.keys(this.trustedKeys) as TrustedEntities[];
    }

    public get trustedPublicKeys(): TrustedPublicKeys {
        return this.publicKeys;
    }*/

    public get minimum(): number {
        return this.authorityConfig.minimum;
    }

    public get transactionMinimum(): number {
        return this.authorityConfig.transactionMinimum;
    }

    /*public get minimumValidatorTransactionGeneration(): number {
        return this.authorityConfig.minimumValidatorTransactionGeneration;
    }

    public get maximumValidatorPerTrustedEntities(): number {
        return this.authorityConfig.maximumValidatorPerTrustedEntities;
    }

    public get trustedPublicKeysRespectingConstraints(): TrustedPublicKeysWithConstraints {
        const trustedPublicKeys: Partial<TrustedPublicKeys> = {};
        const maximumValidatorPerTrustedEntities = this.maximumValidatorPerTrustedEntities;

        let totalKeys: number = 0;
        let totalEntitiesUsed: number = 0;
        for (const trustedCompany in this.trustedKeys) {
            const trustedPublicKeysForCompany =
                this.trustedKeys[trustedCompany as TrustedEntities];
            if (!trustedPublicKeysForCompany) continue;

            const keys: Buffer[] = trustedPublicKeysForCompany.keys.map(
                (key: AuthorityBufferKey) => {
                    return key.publicKey;
                },
            );

            if (keys.length === 0) continue;
            const shuffledPublicKeys: Buffer[] = shuffleArray(keys);

            // Now we need to remove keys so that the number of keys is less than or equal to the maximumValidatorPerTrustedEntities
            const shuffledPublicKeysLength = shuffledPublicKeys.length;
            const keysToRemove: number =
                shuffledPublicKeysLength - maximumValidatorPerTrustedEntities;

            if (keysToRemove > 0) {
                shuffledPublicKeys.splice(0, keysToRemove);
            }

            if (shuffledPublicKeys.length) {
                totalKeys += shuffledPublicKeys.length;
                totalEntitiesUsed++;

                trustedPublicKeys[trustedCompany as TrustedEntities] = shuffledPublicKeys;
            }
        }

        if (totalKeys < this.minimum || totalKeys < this.transactionMinimum) {
            throw new Error(
                `Not enough trusted keys to satisfy the minimum requirement for a transaction. Provided ${totalKeys} keys but need at least ${this.minimum} keys - ${this.transactionMinimum} keys for a transaction.`,
            );
        }

        if (totalEntitiesUsed < this.minimumValidatorTransactionGeneration) {
            this.error(
                `Less than ${this.minimumValidatorTransactionGeneration} trusted entities used. Please make sure that your OPNet validator is up to date.`,
            );

            throw new Error(
                'Not enough trusted entities to satisfy the transaction minimum requirement',
            );
        }

        const allKeys: Buffer[][] = [];
        for (const key of Object.values(trustedPublicKeys)) {
            allKeys.push(key);
        }

        const keys: Buffer[] = allKeys.flat();
        const companies: TrustedEntities[] = Object.keys(trustedPublicKeys) as TrustedEntities[];

        return {
            keys,
            entities: companies,
            constraints: {
                minimum: this.minimum,
                minimumSignatureRequired: this.transactionMinimum,
            },
        };
    }

    public isOrWasTrustedPublicKey(publicKey: Buffer): PublicAuthorityKey | false {
        for (const trustedCompany in this.trustedKeys) {
            const trustedPublicKeys = this.trustedKeys[trustedCompany as TrustedEntities];
            if (!trustedPublicKeys) continue;

            for (const key of trustedPublicKeys.keys) {
                if (toXOnly(key.publicKey).equals(publicKey)) {
                    return { key: key.publicKey, authority: trustedCompany as TrustedEntities };
                }
            }
        }

        return false;
    }

    public opnetFeeWallet(): Address {
        const wallet = OPNET_FEE_WALLET[this.chainId][this.network];

        if (!wallet) {
            throw new Error('OPNet fee wallet not found');
        }

        return wallet.address;
    }

    public getWalletFromPublicKey(publicKey: Buffer): Address | undefined {
        for (const trustedCompany in this.trustedKeys) {
            const trustedPublicKeys = this.trustedKeys[trustedCompany as TrustedEntities];
            if (!trustedPublicKeys) continue;

            for (const key of trustedPublicKeys.keys) {
                if (key.publicKey.equals(publicKey)) {
                    return key.wallet;
                }
            }
        }

        return;
    }

    public verifyPublicKeysConstraints(publicKeys: Buffer[]): boolean {
        // we need to verify that the public keys are less than or equal to the maximumValidatorPerTrustedEntities for each trusted company
        let differentTrustedKeysInList: number = 0;
        let totalEntitiesUsed: number = 0;

        for (const trustedCompany in this.trustedKeys) {
            const trustedPublicKeysForCompany =
                this.trustedKeys[trustedCompany as TrustedEntities];
            if (!trustedPublicKeysForCompany) continue;

            const keys: Buffer[] = trustedPublicKeysForCompany.keys.map(
                (key: AuthorityBufferKey) => {
                    return key.publicKey;
                },
            );

            if (keys.length === 0) continue;

            const matchingKeys: Buffer[] = [];
            for (const publicKey of publicKeys) {
                for (const key of keys) {
                    if (publicKey.equals(key)) {
                        matchingKeys.push(publicKey);
                    }
                }
            }

            if (matchingKeys.length === 0) continue;
            if (matchingKeys.length > this.maximumValidatorPerTrustedEntities) {
                differentTrustedKeysInList += this.maximumValidatorPerTrustedEntities;
            } else {
                differentTrustedKeysInList += matchingKeys.length;
            }

            totalEntitiesUsed++;
        }

        // we need to verify that the public keys are greater than or equal to the minimum number of trusted keys
        if (differentTrustedKeysInList < this.minimum) {
            if (Config.DEBUG_LEVEL >= DebugLevel.TRACE) {
                this.warn(
                    `Less than ${this.minimum} validator were used in this transaction. Used ${differentTrustedKeysInList} validators.`,
                );
            }

            return false;
        }

        if (differentTrustedKeysInList < this.transactionMinimum) {
            if (Config.DEBUG_LEVEL >= DebugLevel.INFO) {
                this.warn(
                    `Less than ${this.transactionMinimum} validator were used, if this value reach the minimum, the funds will be lost and unrecognized by opnet.`,
                );
            }
        }

        return totalEntitiesUsed >= this.minimumValidatorTransactionGeneration;
    }*/

    public verifyTrustedSignature(
        data: Buffer,
        signature: Buffer,
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

    /*private getWBTCDeploymentInfo(): { addresses: string[]; deployer: Address } {
        const wbtcChainId = WBTC_CONTRACT_ADDRESS[this.chainId];
        if (!wbtcChainId) {
            throw new Error('WBTC contract address not found');
        }

        const wbtcAddress = wbtcChainId[this.network];
        if (!wbtcAddress) {
            throw new Error('WBTC contract address not found');
        }

        return wbtcAddress;
    }*/

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

    /*private getTrustedPublicKeys(): TrustedPublicKeys {
        const publicKeys: Partial<TrustedPublicKeys> = {};

        for (const trustedCompany in this.trustedKeys) {
            const trustedPublicKeys = this.trustedKeys[trustedCompany as TrustedEntities];
            if (!trustedPublicKeys) continue;

            publicKeys[trustedCompany as TrustedEntities] = trustedPublicKeys.keys.map(
                (key: AuthorityBufferKey) => {
                    return key.publicKey;
                },
            );
        }

        return publicKeys as TrustedPublicKeys;
    }*/

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
                        publicKey: Buffer.from(key.publicKey, 'base64'),
                        opnet: Buffer.from(key.opnet, 'base64'),
                        signature: Buffer.from(key.signature, 'base64'),
                        wallet: new Address(Buffer.from(key.walletPubKey.replace('0x', ''), 'hex')),
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
                        `Duplicate key found for ${trustedCompany} -> ${key.opnet.toString('base64')}`,
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
