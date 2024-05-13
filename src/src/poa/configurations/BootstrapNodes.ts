import { BitcoinNetwork } from '@btc-vision/bsi-common';
import { ChainIds } from '../../config/enums/ChainIds.js';

type BootstrapNode = {
    [key in BitcoinNetwork]?: string[];
};

type BootstrapNodes = {
    [key in ChainIds]?: BootstrapNode;
};

export const BootstrapNodes: BootstrapNodes = {
    [ChainIds.Bitcoin]: {
        [BitcoinNetwork.Mainnet]: [],

        [BitcoinNetwork.TestNet]: [
            '/ip4/51.81.67.34/tcp/9800/p2p/12D3KooWEJQQ3a7gXtbfAZgHLbSmDpTtA8E2xPeqfm31Fky3PCKn',
        ],

        [BitcoinNetwork.Regtest]: [
            '/ip4/51.81.67.34/tcp/9800/p2p/12D3KooWEJQQ3a7gXtbfAZgHLbSmDpTtA8E2xPeqfm31Fky3PCKn',
            '/ip4/192.168.50.136/tcp/9800/p2p/12D3KooWKfezkLJSZXSu8qcf9DPNVDY8PNtCSGd3BzFptLjsDou6', // real
        ],

        [BitcoinNetwork.Signet]: [],
    },
};
