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
                'tb1qj58a6yf4pez426nqvf8wyu6ssggcajw8kr44vy',
                'tb1pn64fz4cwzej0qd5luwcvpt7laqk3wuvvss0yx6n2ptdlypfnfzrqxqn9pr',
            ],
            deployer: 'tb1p5gsptxjfx4slghcw444umy6pzspy6yfq5cv95mu26rpcpgtduzds8y5h90',
        },

        [BitcoinNetwork.Regtest]: {
            addresses: [
                'bcrt1qh0qmsl04mpy3u8gvur0ghn6gc9x7t38n8avn2r',
                'bcrt1pv47q9kvk2da5tylnrkvw9em4qrumdc2kpzr4adf7gw3humpkkmqqn4f8tw',
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
