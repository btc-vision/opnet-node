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
            '/ip4/51.81.67.34/tcp/9800/p2p/12D3KooW9wz3yAJX5qxXKWyDz1GpyKxscSTtYZwfFvRPvNjp59df',
        ],

        [BitcoinNetwork.Regtest]: [
            '/ip4/192.168.50.136/tcp/9800/p2p/12D3KooWLtuynNCXkRB7YzC8SQnR8b8GSHFBqt4DcZnNHd6rJjyy', // real
        ],

        [BitcoinNetwork.Signet]: [],
    },
};
