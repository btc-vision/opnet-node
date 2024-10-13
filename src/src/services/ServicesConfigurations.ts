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
        maxInstance: Math.ceil(Config.RPC.THREADS / 2),
        target: './src/blockchain-indexer/rpc/thread/BitcoinRPCThread.js',
    },

    [ThreadTypes.POA]: {
        maxInstance: 1,
        target: './src/poa/PoAThread.js',
        managerTarget: './src/poa/PoAThreadManager.js',
    },

    [ThreadTypes.SSH]: {
        maxInstance: 1,
        target: './src/ssh/SSHThread.js',
        managerTarget: './src/ssh/SSHManager.js',
    },

    [ThreadTypes.MEMPOOL]: {
        maxInstance: Config.MEMPOOL.THREADS,
        target: './src/poa/mempool/MempoolThread.js',
        managerTarget: './src/poa/mempool/MempoolThreadManager.js',
    },

    [ThreadTypes.MEMPOOL_MANAGER]: {
        maxInstance: 1,
        target: './src/poa/mempool/bitcoin-mempool/thread/BitcoinMempoolThread.js',
        managerTarget: './src/poa/mempool/bitcoin-mempool/thread/BitcoinMempoolManager.js',
    },

    [ThreadTypes.SYNCHRONISATION]: {
        maxInstance: 4,
        managerTarget: './src/blockchain-indexer/sync/SynchronisationManager.js',
        target: './src/blockchain-indexer/sync/SynchronisationThread.js',
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
            maxOldGenerationSizeMb: 1024,
            maxYoungGenerationSizeMb: 1024,
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

    [ThreadTypes.POA]: {
        resourceLimits: {
            maxOldGenerationSizeMb: 1024 * 6,
            maxYoungGenerationSizeMb: 1024 * 2,
            stackSizeMb: 256,
        },
    },

    [ThreadTypes.SSH]: {
        resourceLimits: {
            maxOldGenerationSizeMb: 1024,
            maxYoungGenerationSizeMb: 1024,
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
            maxOldGenerationSizeMb: 1024 * 4,
            maxYoungGenerationSizeMb: 1024 * 2,
            stackSizeMb: 256,
        },
    },
};
