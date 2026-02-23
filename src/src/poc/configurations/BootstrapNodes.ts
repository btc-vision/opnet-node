import { ChainIds } from '../../config/enums/ChainIds.js';

import { BitcoinNetwork } from '../../config/network/BitcoinNetwork.js';

type BootstrapNode = {
    [key in BitcoinNetwork]?: string[];
};

type BootstrapNodes = {
    [key in ChainIds]: BootstrapNode;
};

export const BootstrapNodes: BootstrapNodes = {
    [ChainIds.Bitcoin]: {
        [BitcoinNetwork.mainnet]: [
            '/dns/bootstrap-mainnet.opnet.org/tcp/9805/p2p/12D3KooWJtgbNFdx1g57N3fEpaVkd3QdfwT2Sbp4Gs3XJUrUnZGf',
        ],

        [BitcoinNetwork.testnet]: [
            '/dns/bootstrap-testnet.opnet.org/tcp/9901/p2p/12D3KooWRyqLF68AsTWTvKavxB2KKhGBnLPXQ6ev6Eq9GcBqinJm',
        ],

        [BitcoinNetwork.testnet4]: [],

        [BitcoinNetwork.regtest]: [
            '/dns/bootstrap2.opnet.org/tcp/9800/p2p/12D3KooWKQLCmBfoUYi8DTFHAFHNThxNbyL8WnvBHYKK7HThsqw3',
        ],

        [BitcoinNetwork.signet]: [],
    },

    [ChainIds.Fractal]: {
        [BitcoinNetwork.mainnet]: [],

        [BitcoinNetwork.testnet]: [],

        [BitcoinNetwork.regtest]: [],

        [BitcoinNetwork.signet]: [],
    },

    [ChainIds.Dogecoin]: {
        [BitcoinNetwork.mainnet]: [],

        [BitcoinNetwork.testnet]: [],

        [BitcoinNetwork.regtest]: [],

        [BitcoinNetwork.signet]: [],
    },

    [ChainIds.Litecoin]: {
        [BitcoinNetwork.mainnet]: [],

        [BitcoinNetwork.testnet]: [],

        [BitcoinNetwork.regtest]: [],

        [BitcoinNetwork.signet]: [],
    },
};
