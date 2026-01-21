import { WorkerOptions } from 'worker_threads';
import { Config } from '../config/Config.js';
import { ThreaderConfigurations } from '../threading/interfaces/ThreaderConfigurations.js';
import { ThreadTypes } from '../threading/thread/enums/ThreadTypes.js';

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

    [ThreadTypes.INDEXER]: {
        maxInstance: 1,
        managerTarget: './src/blockchain-indexer/BlockchainIndexerManager.js',
        target: './src/blockchain-indexer/BlockchainIndexerThread.js',
    },

    [ThreadTypes.RPC]: {
        maxInstance: Config.RPC.CHILD_PROCESSES,
        target: './src/blockchain-indexer/rpc/thread/BitcoinRPCThread.js',
    },

    [ThreadTypes.P2P]: {
        maxInstance: 1,
        target: './src/poc/PoCThread.js',
        managerTarget: './src/poc/PoCThreadManager.js',
    },

    [ThreadTypes.SSH]: {
        maxInstance: 1,
        target: './src/ssh/SSHThread.js',
        managerTarget: './src/ssh/SSHManager.js',
    },

    [ThreadTypes.MEMPOOL]: {
        maxInstance: Config.MEMPOOL.THREADS,
        target: './src/poc/mempool/MempoolThread.js',
        managerTarget: './src/poc/mempool/MempoolThreadManager.js',
    },

    [ThreadTypes.MEMPOOL_MANAGER]: {
        maxInstance: 1,
        target: './src/poc/mempool/bitcoin-mempool/thread/BitcoinMempoolThread.js',
        managerTarget: './src/poc/mempool/bitcoin-mempool/thread/BitcoinMempoolManager.js',
    },

    [ThreadTypes.SYNCHRONISATION]: {
        maxInstance: 12,
        managerTarget: './src/blockchain-indexer/sync/SynchronisationManager.js',
        target: './src/blockchain-indexer/sync/SynchronisationThread.js',
    },

    [ThreadTypes.PLUGIN]: {
        maxInstance: 1,
        managerTarget: './src/plugins/PluginThreadManager.js',
        target: './src/plugins/PluginThread.js',
    },
};

export const WorkerConfigurations: { [key in ThreadTypes]: WorkerOptions } = {
    [ThreadTypes.API]: {
        resourceLimits: {
            maxOldGenerationSizeMb: 1024 * 16,
            maxYoungGenerationSizeMb: 1024 * 4,
            stackSizeMb: 512,
        },
    },

    [ThreadTypes.DOCS]: {
        resourceLimits: {
            maxOldGenerationSizeMb: 256,
            maxYoungGenerationSizeMb: 256,
            stackSizeMb: 256,
        },
    },

    [ThreadTypes.INDEXER]: {
        resourceLimits: {
            maxOldGenerationSizeMb: 1024 * 12,
            maxYoungGenerationSizeMb: 1024 * 4,
            stackSizeMb: 256,
        },
    },

    [ThreadTypes.RPC]: {
        resourceLimits: {
            maxOldGenerationSizeMb: 1024 * 2,
            maxYoungGenerationSizeMb: 1024,
            stackSizeMb: 256,
        },
    },

    [ThreadTypes.P2P]: {
        resourceLimits: {
            maxOldGenerationSizeMb: 1024 * 8,
            maxYoungGenerationSizeMb: 1024 * 2,
            stackSizeMb: 256,
        },
    },

    [ThreadTypes.SSH]: {
        resourceLimits: {
            maxOldGenerationSizeMb: 512,
            maxYoungGenerationSizeMb: 512,
            stackSizeMb: 256,
        },
    },

    [ThreadTypes.MEMPOOL]: {
        resourceLimits: {
            maxOldGenerationSizeMb: 1024 * 2,
            maxYoungGenerationSizeMb: 1024,
            stackSizeMb: 256,
        },
    },

    [ThreadTypes.MEMPOOL_MANAGER]: {
        resourceLimits: {
            maxOldGenerationSizeMb: 1024 * 2,
            maxYoungGenerationSizeMb: 1024,
            stackSizeMb: 256,
        },
    },

    [ThreadTypes.SYNCHRONISATION]: {
        resourceLimits: {
            maxOldGenerationSizeMb: 1024 * 6,
            maxYoungGenerationSizeMb: 1024 * 3,
            stackSizeMb: 256,
        },
    },

    [ThreadTypes.PLUGIN]: {
        resourceLimits: {
            maxOldGenerationSizeMb: 1024 * 4,
            maxYoungGenerationSizeMb: 1024 * 2,
            stackSizeMb: 256,
        },
    },
};
