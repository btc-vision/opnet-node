import { BitcoinNetwork } from '@btc-vision/bsi-common';
import { ChainIds } from '../../config/enums/ChainIds.js';
import { RegTestTrustedKeys001 } from './keys/0.0.1/RegtestTrustedKeys001.js';
import { TrustedPublicKeys } from './types/TrustedPublicKeys.js';

/**
 * DO NOT MODIFY THIS FILE IF YOU DON'T KNOW WHAT YOU ARE DOING.
 *
 * This file is used to set the version of the P2P protocol used by OPNet.
 */
export const P2PVersion = '0.0.1';

export const TRUSTED_CHECKSUM: { [key: string]: string } = {
    '0.0.1': '0x00000000',
};

export const TRUSTED_PUBLIC_KEYS: { [key: string]: TrustedPublicKeys } = {
    '0.0.1': {
        [ChainIds.Bitcoin]: {
            [BitcoinNetwork.Mainnet]: RegTestTrustedKeys001,
            [BitcoinNetwork.TestNet]: RegTestTrustedKeys001,
            [BitcoinNetwork.Regtest]: RegTestTrustedKeys001,
            [BitcoinNetwork.Signet]: [],
        },
    },
};
