import { ChainIds } from '../../config/enums/ChainIds.js';
import { MainnetTrustedKeys001 } from './keys/bitcoin/0.0.1/MainnetTrustedKeys001.js';
import { RegTestTrustedKeys001 } from './keys/bitcoin/0.0.1/RegtestTrustedKeys001.js';
import { TestNetTrustedKeys001 } from './keys/bitcoin/0.0.1/TestnetTrustedKeys001.js';
import { TrustedPublicKeys } from './types/TrustedPublicKeys.js';
import { SignetTrustedKeys001 } from './keys/bitcoin/0.0.1/SignetTrustedKeys001.js';
import { TrustedVersion } from './version/TrustedVersion.js';
import { MainnetTrustedKeys001Fractal } from './keys/fractal/0.0.1/MainnetTrustedKeys001Fractal.js';
import { TestnetTrustedKeys001Fractal } from './keys/fractal/0.0.1/TestnetTrustedKeys001Fractal.js';

import { BitcoinNetwork } from '../../config/network/BitcoinNetwork.js';
import { DogecoinMainnetTrustedKeys } from './keys/dogecoin/0.0.1/MainnetTrustedKeys001.js';
import { DogecoinTestnetTrustedKeys } from './keys/dogecoin/0.0.1/TestnetTrustedKeys001.js';
import { LitecoinMainnetTrustedKeys } from './keys/litecoin/0.0.1/MainnetTrustedKeys001.js';
import { LitecoinTestnetTrustedKeys } from './keys/litecoin/0.0.1/TestnetTrustedKeys001.js';

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
        [ChainIds.Dogecoin]: {
            [BitcoinNetwork.mainnet]: DogecoinMainnetTrustedKeys,
            [BitcoinNetwork.testnet]: DogecoinTestnetTrustedKeys,
        },
        [ChainIds.Litecoin]: {
            [BitcoinNetwork.mainnet]: LitecoinMainnetTrustedKeys,
            [BitcoinNetwork.testnet]: LitecoinTestnetTrustedKeys,
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
        [ChainIds.Dogecoin]: {
            [BitcoinNetwork.mainnet]: DogecoinMainnetTrustedKeys,
            [BitcoinNetwork.testnet]: DogecoinTestnetTrustedKeys,
        },
        [ChainIds.Litecoin]: {
            [BitcoinNetwork.mainnet]: LitecoinMainnetTrustedKeys,
            [BitcoinNetwork.testnet]: LitecoinTestnetTrustedKeys,
        },
    },
};
