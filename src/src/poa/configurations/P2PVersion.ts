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
