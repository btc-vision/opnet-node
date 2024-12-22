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
        [BitcoinNetwork.mainnet]: [],

        [BitcoinNetwork.testnet]: [],

        [BitcoinNetwork.regtest]: [
            '/ip4/192.168.50.193/tcp/9800/p2p/12D3KooWLtuynNCXkRB7YzC8SQnR8b8GSHFBqt4DcZnNHd6rJjyy',
            '/dns/bootstrap.opnet.org/tcp/9800/p2p/12D3KooWKEgattxUEYW793mCFnaZKJ54tC3Xrnq1gUmwcExNpSAo',
            '/dns/bootstrap2.opnet.org/tcp/9800/p2p/12D3KooWGboCARYNFCHWgR6Yp5UYcBfkBg4FRegfFR8B2jj6HCX3',
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

        [BitcoinNetwork.testnet]: [
            '/dns/bootstrap-dogecoin.opnet.org/tcp/9800/p2p/12D3KooWKsEbfsxa6daEZ4fhBjDmkKU1pBPMUFeFmPFhrZY3Qt2P',
        ],

        [BitcoinNetwork.regtest]: [],

        [BitcoinNetwork.signet]: [],
    },
};
