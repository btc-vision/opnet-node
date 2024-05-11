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
            '/ip4/51.81.67.34/tcp/9800/p2p/12D3KooWR6md7NNX8NAd3HNQiqNRVCTbrBbL4ExBFAfGapAWvY5U',
        ],

        [BitcoinNetwork.Regtest]: [
            '/ip4/51.81.67.34/tcp/9800/p2p/12D3KooWR6md7NNX8NAd3HNQiqNRVCTbrBbL4ExBFAfGapAWvY5U',
        ],

        [BitcoinNetwork.Signet]: [],
    },
};
