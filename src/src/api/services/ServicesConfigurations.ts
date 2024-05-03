import { WorkerOptions } from 'worker_threads';
import { Config } from '../../config/Config.js';
import { ThreaderConfigurations } from '../../threading/interfaces/ThreaderConfigurations.js';
import { ThreadTypes } from '../../threading/thread/enums/ThreadTypes.js';

export const ServicesConfigurations: { [key in ThreadTypes]: ThreaderConfigurations } = {
    [ThreadTypes.API]: {
        maxInstance: Config.API.THREADS,
        managerTarget: './src/api/APIManager.js',
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
        target: './src/blockchain-indexer/zeromq/thread/ZeroMQThread.js',
    },

    [ThreadTypes.BITCOIN_RPC]: {
        maxInstance: Config.RPC.THREADS,
        target: './src/blockchain-indexer/rpc/thread/BitcoinRPCThread.js',
    },
};

export const WorkerConfigurations: { [key in ThreadTypes]: WorkerOptions } = {
    [ThreadTypes.API]: {
        resourceLimits: {
            maxOldGenerationSizeMb: 1024 * 4,
            maxYoungGenerationSizeMb: 1024,
            stackSizeMb: 256,
        },
    },

    [ThreadTypes.DOCS]: {
        resourceLimits: {
            maxOldGenerationSizeMb: 1024,
            maxYoungGenerationSizeMb: 1024,
            stackSizeMb: 256,
        },
    },

    [ThreadTypes.VM]: {
        resourceLimits: {
            maxOldGenerationSizeMb: 1024 * 4,
            maxYoungGenerationSizeMb: 1024 * 2,
            stackSizeMb: 256,
        },
    },

    [ThreadTypes.BITCOIN_INDEXER]: {
        resourceLimits: {
            maxOldGenerationSizeMb: 1024 * 12,
            maxYoungGenerationSizeMb: 1024 * 4,
            stackSizeMb: 256,
        },
    },

    [ThreadTypes.ZERO_MQ]: {
        resourceLimits: {
            maxOldGenerationSizeMb: 1024 * 2,
            maxYoungGenerationSizeMb: 1024,
            stackSizeMb: 256,
        },
    },

    [ThreadTypes.BITCOIN_RPC]: {
        resourceLimits: {
            maxOldGenerationSizeMb: 1024 * 6,
            maxYoungGenerationSizeMb: 1024 * 2,
            stackSizeMb: 256,
        },
    },
};
