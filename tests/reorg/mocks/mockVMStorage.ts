import { VMMongoStorage } from '../../../src/src/vm/storage/databases/VMMongoStorage.js';
import { AllMockRepositories } from './mockRepositories.js';

/**
 * Injects mock repositories into a VMMongoStorage instance by directly setting private fields.
 * This avoids calling the real init() which requires MongoDB.
 */
export function injectMockRepositories(storage: VMMongoStorage, mocks: AllMockRepositories): void {
    const s = storage as Record<string, unknown>;
    s.transactionRepository = mocks.transactionRepository;
    s.unspentTransactionRepository = mocks.unspentTransactionRepository;
    s.contractRepository = mocks.contractRepository;
    s.pointerRepository = mocks.pointerRepository;
    s.blockRepository = mocks.blockRepository;
    s.blockWitnessRepository = mocks.blockWitnessRepository;
    s.reorgRepository = mocks.reorgRepository;
    s.epochRepository = mocks.epochRepository;
    s.epochSubmissionRepository = mocks.epochSubmissionRepository;
    s.mldsaPublicKeysRepository = mocks.mldsaPublicKeysRepository;
    s.mempoolRepository = mocks.mempoolRepository;
    s.targetEpochRepository = mocks.targetEpochRepository;
    s.blockchainInfoRepository = mocks.blockchainInfoRepository;
    s.initialized = true;
}

/**
 * Creates a VMMongoStorage with mock config, without requiring a real DB manager.
 */
export function createMockVMMongoStorage(config: Record<string, unknown>): VMMongoStorage {
    // VMMongoStorage constructor accepts (config, databaseManager?)
    // We pass a minimal config and no databaseManager
    const mockDbManager = {
        db: null,
        getConfigs: () => config,
        setup: async () => {},
        close: async () => {},
    };
    return new VMMongoStorage(config as never, mockDbManager as never);
}
