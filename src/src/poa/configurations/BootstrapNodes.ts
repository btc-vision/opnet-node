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
            '/ip4/192.168.0.161/tcp/9800/p2p/12D3KooWSRT2Gk4PfDmRnYjh7tC6nJXAHqU1hkC95f1j49eje9gr',
            '/dns/bootstrap.opnet.org/tcp/9800/p2p/12D3KooWKEgattxUEYW793mCFnaZKJ54tC3Xrnq1gUmwcExNpSAo',
            '/dns/bootstrap.opnet.org/tcp/9800/p2p/12D3KooWHyhNfZzufdVnoQUSJiDtZW1oQwuQMiHjZA2gsxr4eb7Z',
            '/dns/bootstrap2.opnet.org/tcp/9800/p2p/12D3KooWGboCARYNFCHWgR6Yp5UYcBfkBg4FRegfFR8B2jj6HCX3',
            '/dns/bootstrap2.opnet.org/tcp/9800/p2p/12D3KooWHyhNfZzufdVnoQUSJiDtZW1oQwuQMiHjZA2gsxr4eb7Z',
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
