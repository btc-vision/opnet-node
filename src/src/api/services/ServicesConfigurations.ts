import { Config } from '../../config/Config.js';
import { ThreaderConfigurations } from '../../threading/interfaces/ThreaderConfigurations.js';
import { ThreadTypes } from '../../threading/thread/enums/ThreadTypes.js';

export const ServicesConfigurations: { [key in ThreadTypes]: ThreaderConfigurations } = {
    [ThreadTypes.API]: {
        maxInstance: Config.API.THREADS,
        managerTarget: './src/api/ApiManager.js',
        target: './src/api/ServerThread.js',
    },

    [ThreadTypes.DOCS]: {
        maxInstance: 1,
        managerTarget: './src/docs/Docs.js',
    },

    [ThreadTypes.VM]: {
        maxInstance: 1,
        managerTarget: './src/vm/VMThread.js',
    },

    [ThreadTypes.BITCOIN_INDEXER]: {
        maxInstance: 1,
        managerTarget: './src/blockchain-indexer/BlockchainIndexerManager.js',
        target: './src/blockchain-indexer/BitcoinIndexerThread.js',
    },

    [ThreadTypes.ZERO_MQ]: {
        maxInstance: 1,
        target: './src/blockchain-indexer/zeromq/ZeroMQThread.js',
    },
};
