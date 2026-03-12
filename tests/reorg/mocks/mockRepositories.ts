import { vi } from 'vitest';

export function createMockTransactionRepository() {
    return {
        deleteTransactionsFromBlockHeight: vi.fn().mockResolvedValue(undefined),
        deleteTransactionsInRange: vi.fn().mockResolvedValue(undefined),
    };
}

export function createMockUnspentTransactionRepository() {
    return {
        deleteTransactionsFromBlockHeight: vi.fn().mockResolvedValue(undefined),
        deleteTransactionsInRange: vi.fn().mockResolvedValue(undefined),
        deleteGreaterThanBlockHeight: vi.fn().mockResolvedValue(undefined),
    };
}

export function createMockContractRepository() {
    return {
        deleteContractsFromBlockHeight: vi.fn().mockResolvedValue(undefined),
        deleteContractsInRange: vi.fn().mockResolvedValue(undefined),
    };
}

export function createMockPointerRepository() {
    return {
        deletePointerFromBlockHeight: vi.fn().mockResolvedValue(undefined),
        deletePointerInRange: vi.fn().mockResolvedValue(undefined),
    };
}

export function createMockBlockRepository() {
    return {
        deleteBlockHeadersFromBlockHeight: vi.fn().mockResolvedValue(undefined),
        deleteBlockHeadersInRange: vi.fn().mockResolvedValue(undefined),
        getLatestBlock: vi.fn().mockResolvedValue(undefined),
        getBlockHeader: vi.fn().mockResolvedValue(undefined),
    };
}

export function createMockBlockWitnessRepository() {
    return {
        deleteBlockWitnessesFromHeight: vi.fn().mockResolvedValue(undefined),
        deleteBlockWitnessesInRange: vi.fn().mockResolvedValue(undefined),
    };
}

export function createMockReorgsRepository() {
    return {
        deleteReorgs: vi.fn().mockResolvedValue(undefined),
        deleteReorgsInRange: vi.fn().mockResolvedValue(undefined),
    };
}

export function createMockEpochRepository() {
    return {
        deleteEpochFromBitcoinBlockNumber: vi.fn().mockResolvedValue(undefined),
        deleteEpochInRange: vi.fn().mockResolvedValue(undefined),
    };
}

export function createMockEpochSubmissionRepository() {
    return {
        deleteSubmissionsFromBlock: vi.fn().mockResolvedValue(undefined),
        deleteSubmissionsInRange: vi.fn().mockResolvedValue(undefined),
    };
}

export function createMockMLDSAPublicKeyRepository() {
    return {
        deleteFromBlockHeight: vi.fn().mockResolvedValue(undefined),
        deleteInRange: vi.fn().mockResolvedValue(undefined),
    };
}

export function createMockMempoolRepository() {
    return {
        deleteGreaterThanBlockHeight: vi.fn().mockResolvedValue(undefined),
    };
}

export function createMockTargetEpochRepository() {
    return {
        deleteAllTargetEpochs: vi.fn().mockResolvedValue(undefined),
    };
}

export function createMockBlockchainInfoRepository() {
    return {
        getByNetwork: vi.fn().mockResolvedValue({ inProgressBlock: 0 }),
        updateCurrentBlockInProgress: vi.fn().mockResolvedValue(undefined),
        watchBlockChanges: vi.fn(),
    };
}

export interface AllMockRepositories {
    transactionRepository: ReturnType<typeof createMockTransactionRepository>;
    unspentTransactionRepository: ReturnType<typeof createMockUnspentTransactionRepository>;
    contractRepository: ReturnType<typeof createMockContractRepository>;
    pointerRepository: ReturnType<typeof createMockPointerRepository>;
    blockRepository: ReturnType<typeof createMockBlockRepository>;
    blockWitnessRepository: ReturnType<typeof createMockBlockWitnessRepository>;
    reorgRepository: ReturnType<typeof createMockReorgsRepository>;
    epochRepository: ReturnType<typeof createMockEpochRepository>;
    epochSubmissionRepository: ReturnType<typeof createMockEpochSubmissionRepository>;
    mldsaPublicKeysRepository: ReturnType<typeof createMockMLDSAPublicKeyRepository>;
    mempoolRepository: ReturnType<typeof createMockMempoolRepository>;
    targetEpochRepository: ReturnType<typeof createMockTargetEpochRepository>;
    blockchainInfoRepository: ReturnType<typeof createMockBlockchainInfoRepository>;
}

export function createAllMockRepositories(): AllMockRepositories {
    return {
        transactionRepository: createMockTransactionRepository(),
        unspentTransactionRepository: createMockUnspentTransactionRepository(),
        contractRepository: createMockContractRepository(),
        pointerRepository: createMockPointerRepository(),
        blockRepository: createMockBlockRepository(),
        blockWitnessRepository: createMockBlockWitnessRepository(),
        reorgRepository: createMockReorgsRepository(),
        epochRepository: createMockEpochRepository(),
        epochSubmissionRepository: createMockEpochSubmissionRepository(),
        mldsaPublicKeysRepository: createMockMLDSAPublicKeyRepository(),
        mempoolRepository: createMockMempoolRepository(),
        targetEpochRepository: createMockTargetEpochRepository(),
        blockchainInfoRepository: createMockBlockchainInfoRepository(),
    };
}
