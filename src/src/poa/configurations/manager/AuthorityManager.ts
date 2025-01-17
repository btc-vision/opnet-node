import { TrustedVersion } from '../version/TrustedVersion.js';
import { TrustedAuthority } from './TrustedAuthority.js';
import { BtcIndexerConfig } from '../../../config/BtcIndexerConfig.js';
import { P2PVersion } from '../P2PVersion.js';
import { Config } from '../../../config/Config.js';
import { Logger } from '@btc-vision/bsi-common';

class AuthorityManagerBase extends Logger {
    private readonly versions: Map<TrustedVersion, TrustedAuthority> = new Map();
    private readonly currentVersion: TrustedVersion = P2PVersion;

    constructor(private readonly config: BtcIndexerConfig = Config) {
        super();

        this.loadAuthorities();
    }

    public getAuthority(version: TrustedVersion): TrustedAuthority {
        if (!this.versions.has(version)) {
            throw new Error('Authority not found');
        }

        return this.versions.get(version) as TrustedAuthority;
    }

    public getCurrentAuthority(): TrustedAuthority {
        return this.getAuthority(this.currentVersion);
    }

    /*public isOrWasTrustedPublicKey(publicKey: Buffer): PublicAuthorityKey | false {
        for (const authority of this.versions.values()) {
            const trustedPublicKey = authority.isOrWasTrustedPublicKey(publicKey);
            if (trustedPublicKey) {
                return trustedPublicKey;
            }
        }

        return false;
    }*/

    private loadAuthorities(): void {
        for (const version of Object.values(TrustedVersion)) {
            try {
                const authority: TrustedAuthority = new TrustedAuthority(
                    version,
                    this.config.BITCOIN.CHAIN_ID,
                    this.config.BITCOIN.NETWORK,
                );

                this.versions.set(version, authority);
            } catch (e) {
                this.error(
                    `Failed to load authority for version: ${version}. Error: ${(e as Error).message}`,
                );
            }
        }
    }
}

export const AuthorityManager: AuthorityManagerBase = new AuthorityManagerBase();
