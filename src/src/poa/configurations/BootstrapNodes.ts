import { ChainIds } from '../../config/enums/ChainIds.js';

import { BitcoinNetwork } from '../../config/network/BitcoinNetwork.js';

type BootstrapNode = {
    [key in BitcoinNetwork]?: string[];
};

type BootstrapNodes = {
    [key in ChainIds]?: BootstrapNode;
};

export const BootstrapNodes: BootstrapNodes = {
    [ChainIds.Bitcoin]: {
        [BitcoinNetwork.mainnet]: [],

        [BitcoinNetwork.testnet]: [
            '/ip4/51.81.67.34/tcp/9800/p2p/12D3KooW9wz3yAJX5qxXKWyDz1GpyKxscSTtYZwfFvRPvNjp59df',
            '/ip4/15.204.163.34/tcp/9800/p2p/12D3KooWSJaWd5pirnsqL4jKTcp87NyKPbK18SbM1JJuinb2UAAd',
        ],

        [BitcoinNetwork.regtest]: [
            '/ip4/192.168.50.136/tcp/9800/p2p/12D3KooWLtuynNCXkRB7YzC8SQnR8b8GSHFBqt4DcZnNHd6rJjyy',
            '/ip4/15.204.163.30/tcp/9800/p2p/12D3KooWBFBxUeNoZmrui2ReVDQZcg93AjPqA1gbMFVLmFsU2y5K',
        ],

        [BitcoinNetwork.signet]: [],
    },

    [ChainIds.Fractal]: {
        [BitcoinNetwork.mainnet]: [
            '/ip4/15.204.163.30/tcp/9801/p2p/12D3KooWJ8w5QHsdKGhv96gmEeKve9kAvNMnxbac2waxWcHkF765',
        ],

        [BitcoinNetwork.testnet]: [],

        [BitcoinNetwork.regtest]: [],

        [BitcoinNetwork.signet]: [],
    },
};
