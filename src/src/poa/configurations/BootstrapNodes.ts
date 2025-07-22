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
            '/dns/bootstrap-mainnet.opnet.org/tcp/9700/p2p/12D3KooWJtgbNFdx1g57N3fEpaVkd3QdfwT2Sbp4Gs3XJUrUnZGf',
        ],

        [BitcoinNetwork.testnet]: [
            '/dns/testnet1.opnet.org/tcp/9800/p2p/12D3KooWFHyF5JVze4Z3b11EyZBYBWuKsSTBNCnEkdXyiF31fdEM',
        ],

        [BitcoinNetwork.regtest]: [
            '/dns/bootstrap2.opnet.org/tcp/9800/p2p/12D3KooWG7Rgr6oNWaSZmAbYurBV39kvM9PLmfy5zwxezUZctGh7',
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
