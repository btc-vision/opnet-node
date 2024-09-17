import {ChainIds} from '../../config/enums/ChainIds.js';
import {MainnetTrustedKeys001} from './keys/bitcoin/0.0.1/MainnetTrustedKeys001.js';
import {RegTestTrustedKeys001} from './keys/bitcoin/0.0.1/RegtestTrustedKeys001.js';
import {TestNetTrustedKeys001} from './keys/bitcoin/0.0.1/TestnetTrustedKeys001.js';
import {TrustedPublicKeys} from './types/TrustedPublicKeys.js';
import {SignetTrustedKeys001} from './keys/bitcoin/0.0.1/SignetTrustedKeys001.js';
import {TrustedVersion} from './version/TrustedVersion.js';
import {MainnetTrustedKeys001Fractal} from './keys/fractal/0.0.1/MainnetTrustedKeys001Fractal.js';
import {TestnetTrustedKeys001Fractal} from './keys/fractal/0.0.1/TestnetTrustedKeys001Fractal.js';

import {BitcoinNetwork} from '../../config/network/BitcoinNetwork.js';

/**
 * DO NOT MODIFY THIS FILE IF YOU DON'T KNOW WHAT YOU ARE DOING.
 *
 * This file is used to set the version of the P2P protocol used by OPNet.
 */
export const P2PVersion: TrustedVersion = TrustedVersion.V0_0_1;
export const P2PMajorVersion: TrustedVersion = TrustedVersion.V0_0_1;

// TODO: Add the trusted checksum for the new version
export const TRUSTED_CHECKSUM: { [key in TrustedVersion]: string } = {
    [TrustedVersion.V0_0_1]: '0x00000000',
    [TrustedVersion.V0_0_2]: '0x00000000',
};

export const WBTC_CONTRACT_ADDRESS: {
    [key in ChainIds]: Partial<{
        [key in BitcoinNetwork]: { addresses: string[]; deployer: string };
    }>;
} = {
    [ChainIds.Bitcoin]: {
        [BitcoinNetwork.mainnet]: {
            addresses: ['unknown'],
            deployer: 'unknown',
        },

        [BitcoinNetwork.testnet]: {
            addresses: ['tb1qp28xna6pv47x6wflcplhu0a9hkld5shtvjx6xv'],
            deployer: 'tb1p5gsptxjfx4slghcw444umy6pzspy6yfq5cv95mu26rpcpgtduzds8y5h90',
        },

        [BitcoinNetwork.regtest]: {
            addresses: ['bcrt1qdr7sjgtnudda8zrfklw8l5cnrxum5hns7e46hf'], //WBTC_ADDRESS_REGTEST
            deployer: 'bcrt1pe0slk2klsxckhf90hvu8g0688rxt9qts6thuxk3u4ymxeejw53gs0xjlhn',
        },

        [BitcoinNetwork.signet]: {
            addresses: ['unknown'],
            deployer: 'unknown',
        },
    },
    [ChainIds.Fractal]: {
        [BitcoinNetwork.mainnet]: {
            addresses: ['bc1qdtzlucslvrvu4useyh9r69supqrw3w4xn9t4yv'],
            deployer: 'bc1p823gdnqvk8a90f8cu30w8ywvk29uh8txtqqnsmk6f5ktd7hlyl0qxsjd0h',
        },

        [BitcoinNetwork.testnet]: {
            addresses: ['unknown'],
            deployer: 'unknown',
        },

        [BitcoinNetwork.regtest]: {
            addresses: ['unknown'],
            deployer: 'unknown',
        },

        [BitcoinNetwork.signet]: {
            addresses: ['unknown'],
            deployer: 'unknown',
        },
    },
};

export const TRUSTED_PUBLIC_KEYS: { [key in TrustedVersion]: TrustedPublicKeys } = {
    [TrustedVersion.V0_0_1]: {
        [ChainIds.Bitcoin]: {
            [BitcoinNetwork.mainnet]: MainnetTrustedKeys001,
            [BitcoinNetwork.testnet]: TestNetTrustedKeys001,
            [BitcoinNetwork.regtest]: RegTestTrustedKeys001,
            [BitcoinNetwork.signet]: SignetTrustedKeys001,
        },
        [ChainIds.Fractal]: {
            [BitcoinNetwork.mainnet]: MainnetTrustedKeys001Fractal,
            [BitcoinNetwork.testnet]: TestnetTrustedKeys001Fractal,
            [BitcoinNetwork.regtest]: RegTestTrustedKeys001,
            [BitcoinNetwork.signet]: SignetTrustedKeys001,
        },
    },
    [TrustedVersion.V0_0_2]: {
        [ChainIds.Bitcoin]: {
            [BitcoinNetwork.mainnet]: MainnetTrustedKeys001,
            [BitcoinNetwork.testnet]: TestNetTrustedKeys001,
            [BitcoinNetwork.regtest]: RegTestTrustedKeys001,
            [BitcoinNetwork.signet]: SignetTrustedKeys001,
        },
        [ChainIds.Fractal]: {
            [BitcoinNetwork.mainnet]: MainnetTrustedKeys001Fractal,
            [BitcoinNetwork.testnet]: TestnetTrustedKeys001Fractal,
            [BitcoinNetwork.regtest]: RegTestTrustedKeys001,
            [BitcoinNetwork.signet]: SignetTrustedKeys001,
        },
    },
};
