import { BitcoinNetwork } from '@btc-vision/bsi-common';
import { ChainIds } from '../../config/enums/ChainIds.js';
import { MainnetTrustedKeys001 } from './keys/0.0.1/MainnetTrustedKeys001.js';
import { RegTestTrustedKeys001 } from './keys/0.0.1/RegtestTrustedKeys001.js';
import { TestNetTrustedKeys001 } from './keys/0.0.1/TestnetTrustedKeys001.js';
import { TrustedPublicKeys } from './types/TrustedPublicKeys.js';
import { SignetTrustedKeys001 } from './keys/0.0.1/SignetTrustedKeys001.js';
import { TrustedVersion } from './version/TrustedVersion.js';

/**
 * DO NOT MODIFY THIS FILE IF YOU DON'T KNOW WHAT YOU ARE DOING.
 *
 * This file is used to set the version of the P2P protocol used by OPNet.
 */
export const P2PVersion: TrustedVersion = TrustedVersion.V0_0_1;

export const TRUSTED_CHECKSUM: { [key in TrustedVersion]: string } = {
    [TrustedVersion.V0_0_1]: '0x00000000',
};

export const WBTC_CONTRACT_ADDRESS: {
    [key in ChainIds]: Partial<{
        [key in BitcoinNetwork]: { addresses: string[]; deployer: string };
    }>;
} = {
    [ChainIds.Bitcoin]: {
        [BitcoinNetwork.Mainnet]: {
            addresses: ['unknown'],
            deployer: 'unknown',
        },

        [BitcoinNetwork.TestNet]: {
            addresses: [
                'tb1qh9xlcw7ne5u4eky0ylu5j7fzxjkrcumal2zhcr',
                'tb1ptyk6dw20slnfz2cj2sn8lym8kznsuvrlw25jk2z4j0zh3es6trdqxp0hlv',
            ],
            deployer: 'tb1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gszlcezf',
        },

        [BitcoinNetwork.Regtest]: {
            addresses: [
                'bcrt1qg8p5h65hffqmczyctrdenjx5e5teaz8a7rvrr2',
                'bcrt1p7u5qn2ydc9g5fc3yj6qy858s5jlp3uu6em6wh0hd2e9t5l4er0fq5t3zgf',
            ],
            deployer: 'bcrt1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gs0xjlhn',
        },

        [BitcoinNetwork.Signet]: {
            addresses: ['unknown'],
            deployer: 'unknown',
        },
    },
};

export const TRUSTED_PUBLIC_KEYS: { [key in TrustedVersion]: TrustedPublicKeys } = {
    [TrustedVersion.V0_0_1]: {
        [ChainIds.Bitcoin]: {
            [BitcoinNetwork.Mainnet]: MainnetTrustedKeys001,
            [BitcoinNetwork.TestNet]: TestNetTrustedKeys001,
            [BitcoinNetwork.Regtest]: RegTestTrustedKeys001,
            [BitcoinNetwork.Signet]: SignetTrustedKeys001,
        },
    },
};
