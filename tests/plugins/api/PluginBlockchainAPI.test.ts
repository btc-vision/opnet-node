import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { Binary } from 'mongodb';
import {
    PluginBlockchainAPI,
    PluginBlockchainError,
    IBlockHeader,
} from '../../../src/src/plugins/api/PluginBlockchainAPI.js';
import { IBlockchainPermissions } from '../../../src/src/plugins/interfaces/IPluginPermissions.js';
import { OPNetTransactionTypes } from '../../../src/src/blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';

// Mock all dependencies
vi.mock('../../../src/src/db/repositories/BlockRepository.js', () => ({
    BlockRepository: vi.fn().mockImplementation(() => ({
        getBlockHeader: vi.fn(),
        getBlockByHash: vi.fn(),
    })),
}));

vi.mock('../../../src/src/db/repositories/TransactionRepository.js', () => ({
    TransactionRepository: vi.fn().mockImplementation(() => ({
        getTransactionByHash: vi.fn(),
        getTransactionsByBlockHash: vi.fn(),
    })),
}));

vi.mock('../../../src/src/db/repositories/ContractRepository.js', () => ({
    ContractRepository: vi.fn().mockImplementation(() => ({
        getContract: vi.fn(),
    })),
}));

vi.mock('../../../src/src/db/repositories/ContractPointerValueRepository.js', () => ({
    ContractPointerValueRepository: vi.fn().mockImplementation(() => ({
        getByContractAndPointer: vi.fn(),
    })),
}));

vi.mock('../../../src/src/db/repositories/UnspentTransactionRepository.js', () => ({
    UnspentTransactionRepository: vi.fn().mockImplementation(() => ({
        getWalletUnspentUTXOS: vi.fn(),
    })),
}));

vi.mock('../../../src/src/db/repositories/BlockchainInfoRepository.js', () => ({
    BlockchainInfoRepository: vi.fn().mockImplementation(() => ({
        getByNetwork: vi.fn(),
    })),
}));

vi.mock('../../../src/src/config/Config.js', () => ({
    Config: {
        BITCOIN: {
            NETWORK: 'regtest',
        },
    },
}));

vi.mock('@btc-vision/bsi-common', () => ({
    DataConverter: {
        toDecimal128: vi.fn((val: bigint) => val),
    },
}));

vi.mock('@btc-vision/transaction', () => ({
    Address: {
        fromString: vi.fn((addr: string) => ({ toString: () => addr })),
    },
}));

import { BlockRepository } from '../../../src/src/db/repositories/BlockRepository.js';
import { TransactionRepository } from '../../../src/src/db/repositories/TransactionRepository.js';
import { ContractRepository } from '../../../src/src/db/repositories/ContractRepository.js';
import { ContractPointerValueRepository } from '../../../src/src/db/repositories/ContractPointerValueRepository.js';
import { UnspentTransactionRepository } from '../../../src/src/db/repositories/UnspentTransactionRepository.js';
import { BlockchainInfoRepository } from '../../../src/src/db/repositories/BlockchainInfoRepository.js';

describe('PluginBlockchainAPI', () => {
    let api: PluginBlockchainAPI;
    let mockDb: unknown;
    let mockBlockRepo: { getBlockHeader: Mock; getBlockByHash: Mock };
    let mockTxRepo: { getTransactionByHash: Mock; getTransactionsByBlockHash: Mock };
    let mockContractRepo: { getContract: Mock };
    let mockPointerRepo: { getByContractAndPointer: Mock };
    let mockUtxoRepo: { getWalletUnspentUTXOS: Mock };
    let mockBlockchainInfoRepo: { getByNetwork: Mock };

    const fullPermissions: IBlockchainPermissions = {
        blocks: true,
        transactions: true,
        contracts: true,
        utxos: true,
    };

    const createMockBlockHeader = (height: bigint) => ({
        height: { toString: () => height.toString() },
        hash: 'blockhash123',
        previousBlockHash: 'prevhash456',
        merkleRoot: 'merkle789',
        time: new Date('2024-01-01T00:00:00Z'),
        receiptRoot: 'receipt123',
        storageRoot: 'storage456',
        checksumRoot: 'checksum789',
    });

    beforeEach(() => {
        mockDb = {};

        // Create fresh mocks for each test
        mockBlockRepo = {
            getBlockHeader: vi.fn(),
            getBlockByHash: vi.fn(),
        };
        mockTxRepo = {
            getTransactionByHash: vi.fn(),
            getTransactionsByBlockHash: vi.fn(() => []),
        };
        mockContractRepo = {
            getContract: vi.fn(),
        };
        mockPointerRepo = {
            getByContractAndPointer: vi.fn(),
        };
        mockUtxoRepo = {
            getWalletUnspentUTXOS: vi.fn(() => ({ utxos: [] })),
        };
        mockBlockchainInfoRepo = {
            getByNetwork: vi.fn(() => ({ inProgressBlock: 100 })),
        };

        // Setup mock implementations
        vi.mocked(BlockRepository).mockImplementation(() => mockBlockRepo as never);
        vi.mocked(TransactionRepository).mockImplementation(() => mockTxRepo as never);
        vi.mocked(ContractRepository).mockImplementation(() => mockContractRepo as never);
        vi.mocked(ContractPointerValueRepository).mockImplementation(
            () => mockPointerRepo as never,
        );
        vi.mocked(UnspentTransactionRepository).mockImplementation(() => mockUtxoRepo as never);
        vi.mocked(BlockchainInfoRepository).mockImplementation(
            () => mockBlockchainInfoRepo as never,
        );

        api = new PluginBlockchainAPI('test-plugin', fullPermissions, mockDb as never, 1);
    });

    describe('PluginBlockchainError', () => {
        it('should create error with message and code', () => {
            const error = new PluginBlockchainError('Test error', 'TEST_CODE');
            expect(error.message).toBe('Test error');
            expect(error.code).toBe('TEST_CODE');
            expect(error.name).toBe('PluginBlockchainError');
        });
    });

    describe('permission checking', () => {
        it('should throw when blocks permission is missing', async () => {
            const noBlocksApi = new PluginBlockchainAPI(
                'test-plugin',
                { ...fullPermissions, blocks: false },
                mockDb as never,
                1,
            );

            await expect(noBlocksApi.getBlock(100n)).rejects.toThrow(PluginBlockchainError);
            await expect(noBlocksApi.getBlock(100n)).rejects.toThrow(
                'BLOCKCHAIN_BLOCKS_NOT_PERMITTED',
            );
        });

        it('should throw when transactions permission is missing', async () => {
            const noTxApi = new PluginBlockchainAPI(
                'test-plugin',
                { ...fullPermissions, transactions: false },
                mockDb as never,
                1,
            );

            await expect(noTxApi.getTransaction('txid123')).rejects.toThrow(PluginBlockchainError);
            await expect(noTxApi.getTransaction('txid123')).rejects.toThrow(
                'BLOCKCHAIN_TRANSACTIONS_NOT_PERMITTED',
            );
        });

        it('should throw when contracts permission is missing', async () => {
            const noContractApi = new PluginBlockchainAPI(
                'test-plugin',
                { ...fullPermissions, contracts: false },
                mockDb as never,
                1,
            );

            await expect(noContractApi.getContract('addr123')).rejects.toThrow(
                PluginBlockchainError,
            );
            await expect(noContractApi.getContract('addr123')).rejects.toThrow(
                'BLOCKCHAIN_CONTRACTS_NOT_PERMITTED',
            );
        });

        it('should throw when utxos permission is missing', async () => {
            const noUtxoApi = new PluginBlockchainAPI(
                'test-plugin',
                { ...fullPermissions, utxos: false },
                mockDb as never,
                1,
            );

            await expect(noUtxoApi.getUTXOs('addr123')).rejects.toThrow(PluginBlockchainError);
            await expect(noUtxoApi.getUTXOs('addr123')).rejects.toThrow(
                'BLOCKCHAIN_UTXOS_NOT_PERMITTED',
            );
        });
    });

    describe('getBlock', () => {
        it('should return null when block not found', async () => {
            mockBlockRepo.getBlockHeader.mockResolvedValue(undefined);

            const result = await api.getBlock(100n);

            expect(result).toBeNull();
            expect(mockBlockRepo.getBlockHeader).toHaveBeenCalledWith(100n);
        });

        it('should return mapped block header', async () => {
            mockBlockRepo.getBlockHeader.mockResolvedValue(createMockBlockHeader(100n));

            const result = await api.getBlock(100n);

            expect(result).not.toBeNull();
            expect(result!.height).toBe(100n);
            expect(result!.hash).toBe('blockhash123');
            expect(result!.previousHash).toBe('prevhash456');
            expect(result!.merkleRoot).toBe('merkle789');
            expect(result!.timestamp).toBe(Math.floor(new Date('2024-01-01').getTime() / 1000));
        });
    });

    describe('getBlockByHash', () => {
        it('should return null when block not found', async () => {
            mockBlockRepo.getBlockByHash.mockResolvedValue(undefined);

            const result = await api.getBlockByHash('nonexistent');

            expect(result).toBeNull();
            expect(mockBlockRepo.getBlockByHash).toHaveBeenCalledWith('nonexistent', false);
        });

        it('should return mapped block header', async () => {
            mockBlockRepo.getBlockByHash.mockResolvedValue(createMockBlockHeader(100n));

            const result = await api.getBlockByHash('blockhash123');

            expect(result).not.toBeNull();
            expect(result!.hash).toBe('blockhash123');
        });
    });

    describe('getBlockWithTransactions', () => {
        it('should return null when block not found', async () => {
            mockBlockRepo.getBlockHeader.mockResolvedValue(undefined);

            const result = await api.getBlockWithTransactions(100n);

            expect(result).toBeNull();
        });

        it('should return block with transactions', async () => {
            mockBlockRepo.getBlockHeader.mockResolvedValue(createMockBlockHeader(100n));
            mockTxRepo.getTransactionsByBlockHash.mockResolvedValue([]);

            const result = await api.getBlockWithTransactions(100n);

            expect(result).not.toBeNull();
            expect(result!.height).toBe(100n);
            expect(result!.transactions).toEqual([]);
        });

        it('should require both blocks and transactions permission', async () => {
            const blocksOnlyApi = new PluginBlockchainAPI(
                'test-plugin',
                { ...fullPermissions, transactions: false },
                mockDb as never,
                1,
            );

            await expect(blocksOnlyApi.getBlockWithTransactions(100n)).rejects.toThrow(
                PluginBlockchainError,
            );
        });
    });

    describe('getTransaction', () => {
        it('should return null when transaction not found', async () => {
            mockTxRepo.getTransactionByHash.mockResolvedValue(undefined);

            const result = await api.getTransaction('nonexistent');

            expect(result).toBeNull();
        });

        it('should return mapped transaction', async () => {
            const mockTx = {
                id: Buffer.from('a'.repeat(64), 'hex'),
                hash: Buffer.from('b'.repeat(64), 'hex'),
                blockHeight: { toString: () => '100' },
                index: 0,
                inputs: [],
                outputs: [],
                OPNetType: OPNetTransactionTypes.Generic,
            };
            mockTxRepo.getTransactionByHash.mockResolvedValue(mockTx);

            const result = await api.getTransaction('txid123');

            expect(result).not.toBeNull();
            expect(result!.blockHeight).toBe(100n);
        });
    });

    describe('getTransactionsByBlock', () => {
        it('should return empty array when no transactions', async () => {
            mockTxRepo.getTransactionsByBlockHash.mockResolvedValue([]);

            const result = await api.getTransactionsByBlock(100n);

            expect(result).toEqual([]);
        });

        it('should return mapped transactions', async () => {
            const mockTx = {
                id: Buffer.from('a'.repeat(64), 'hex'),
                hash: Buffer.from('b'.repeat(64), 'hex'),
                blockHeight: { toString: () => '100' },
                index: 0,
                inputs: [],
                outputs: [],
                OPNetType: OPNetTransactionTypes.Generic,
            };
            mockTxRepo.getTransactionsByBlockHash.mockResolvedValue([mockTx]);

            const result = await api.getTransactionsByBlock(100n);

            expect(result).toHaveLength(1);
        });
    });

    describe('getContract', () => {
        it('should return null when contract not found', async () => {
            mockContractRepo.getContract.mockResolvedValue(undefined);

            const result = await api.getContract('nonexistent');

            expect(result).toBeNull();
        });

        it('should return mapped contract info', async () => {
            const mockContract = {
                contractAddress: 'contract123',
                blockHeight: 50n,
                deployedTransactionId: Buffer.from('tx'.repeat(16), 'hex'),
                bytecode: Buffer.from([0x00, 0x01, 0x02]),
                deployerAddress: { toString: () => 'deployer123' },
            };
            mockContractRepo.getContract.mockResolvedValue(mockContract);

            const result = await api.getContract('contract123');

            expect(result).not.toBeNull();
            expect(result!.address).toBe('contract123');
            expect(result!.deploymentHeight).toBe(50n);
            expect(result!.deployer).toBe('deployer123');
            expect(result!.isActive).toBe(true);
        });
    });

    describe('getContractStorage', () => {
        it('should return null when storage value not found', async () => {
            mockPointerRepo.getByContractAndPointer.mockResolvedValue(undefined);

            const result = await api.getContractStorage('contract123', 0n);

            expect(result).toBeNull();
        });

        it('should return storage value', async () => {
            mockPointerRepo.getByContractAndPointer.mockResolvedValue({
                value: new Uint8Array([0x01, 0x02, 0x03]),
            });

            const result = await api.getContractStorage('contract123', 1n);

            expect(result).not.toBeNull();
            expect(result!.toString('hex')).toBe('010203');
        });
    });

    describe('getContractEvents', () => {
        it('should throw not implemented error', async () => {
            await expect(api.getContractEvents('addr', 0n, 100n)).rejects.toThrow(
                PluginBlockchainError,
            );
            await expect(api.getContractEvents('addr', 0n, 100n)).rejects.toThrow(
                'BLOCKCHAIN_EVENTS_NOT_IMPLEMENTED',
            );
        });
    });

    describe('getUTXOs', () => {
        it('should return empty array when no UTXOs', async () => {
            mockUtxoRepo.getWalletUnspentUTXOS.mockResolvedValue({ utxos: [] });

            const result = await api.getUTXOs('addr123');

            expect(result).toEqual([]);
        });

        it('should return mapped UTXOs', async () => {
            mockUtxoRepo.getWalletUnspentUTXOS.mockResolvedValue({
                utxos: [
                    {
                        transactionId: 'txid123',
                        outputIndex: 0,
                        value: 1000n,
                        scriptPubKey: {
                            hex: '76a914abc88ac',
                            address: 'addr123',
                        },
                    },
                ],
            });

            const result = await api.getUTXOs('addr123');

            expect(result).toHaveLength(1);
            expect(result[0].txid).toBe('txid123');
            expect(result[0].vout).toBe(0);
            expect(result[0].value).toBe(1000n);
        });
    });

    describe('getChainTip', () => {
        it('should return current chain tip', async () => {
            mockBlockchainInfoRepo.getByNetwork.mockResolvedValue({ inProgressBlock: 150 });

            const result = await api.getChainTip();

            expect(result).toBe(150n);
        });

        it('should return 0 when no chain info', async () => {
            mockBlockchainInfoRepo.getByNetwork.mockResolvedValue({});

            const result = await api.getChainTip();

            expect(result).toBe(0n);
        });

        it('should not require permissions', async () => {
            const noPermApi = new PluginBlockchainAPI(
                'test-plugin',
                { blocks: false, transactions: false, contracts: false, utxos: false },
                mockDb as never,
                1,
            );
            mockBlockchainInfoRepo.getByNetwork.mockResolvedValue({ inProgressBlock: 100 });

            // Should not throw
            const result = await noPermApi.getChainTip();
            expect(result).toBe(100n);
        });
    });

    describe('getBlockRange', () => {
        it('should return blocks in range', async () => {
            mockBlockRepo.getBlockHeader
                .mockResolvedValueOnce(createMockBlockHeader(100n))
                .mockResolvedValueOnce(createMockBlockHeader(101n))
                .mockResolvedValueOnce(createMockBlockHeader(102n));

            const result = await api.getBlockRange(100n, 102n);

            expect(result).toHaveLength(3);
            expect(result[0].height).toBe(100n);
            expect(result[2].height).toBe(102n);
        });

        it('should limit range to 100 blocks', async () => {
            mockBlockRepo.getBlockHeader.mockImplementation(async (height: bigint) =>
                createMockBlockHeader(height),
            );

            const result = await api.getBlockRange(0n, 200n);

            // Should only fetch 101 blocks (0 to 100 inclusive)
            expect(result).toHaveLength(101);
        });

        it('should skip missing blocks', async () => {
            mockBlockRepo.getBlockHeader
                .mockResolvedValueOnce(createMockBlockHeader(100n))
                .mockResolvedValueOnce(undefined) // Block 101 missing
                .mockResolvedValueOnce(createMockBlockHeader(102n));

            const result = await api.getBlockRange(100n, 102n);

            expect(result).toHaveLength(2);
        });
    });

    describe('hasBlock', () => {
        it('should return true when block exists', async () => {
            mockBlockRepo.getBlockHeader.mockResolvedValue(createMockBlockHeader(100n));

            const result = await api.hasBlock(100n);

            expect(result).toBe(true);
        });

        it('should return false when block does not exist', async () => {
            mockBlockRepo.getBlockHeader.mockResolvedValue(undefined);

            const result = await api.hasBlock(100n);

            expect(result).toBe(false);
        });
    });

    describe('transaction mapping', () => {
        it('should handle Binary inputs correctly', async () => {
            const mockTx = {
                id: new Binary(Buffer.from('a'.repeat(64), 'hex')),
                hash: new Binary(Buffer.from('b'.repeat(64), 'hex')),
                blockHeight: { toString: () => '100' },
                index: 0,
                inputs: [
                    {
                        originalTransactionId: new Binary(Buffer.from('c'.repeat(64), 'hex')),
                        outputTransactionIndex: 1,
                        sequence: 0xfffffffe,
                    },
                ],
                outputs: [
                    {
                        value: 1000n,
                        index: 0,
                        scriptPubKey: {
                            hex: new Binary(Buffer.from('76a914abc88ac', 'hex')),
                            address: 'addr123',
                        },
                    },
                ],
                OPNetType: OPNetTransactionTypes.Generic,
            };
            mockTxRepo.getTransactionByHash.mockResolvedValue(mockTx);

            const result = await api.getTransaction('txid123');

            expect(result).not.toBeNull();
            expect(result!.inputs[0].txid).toHaveLength(64);
            expect(result!.inputs[0].vout).toBe(1);
            expect(result!.inputs[0].sequence).toBe(0xfffffffe);
        });

        it('should handle revert data correctly', async () => {
            const mockTx = {
                id: Buffer.from('a'.repeat(64), 'hex'),
                hash: Buffer.from('b'.repeat(64), 'hex'),
                blockHeight: { toString: () => '100' },
                index: 0,
                inputs: [],
                outputs: [],
                gasUsed: { toString: () => '21000' },
                revert: new Binary(Buffer.from('execution reverted', 'utf8')),
                OPNetType: OPNetTransactionTypes.Generic,
            };
            mockTxRepo.getTransactionByHash.mockResolvedValue(mockTx);

            const result = await api.getTransaction('txid123');

            expect(result).not.toBeNull();
            expect(result!.receipt).toBeDefined();
            expect(result!.receipt!.success).toBe(false);
            expect(result!.receipt!.revertReason).toBe('execution reverted');
            expect(result!.receipt!.gasUsed).toBe(21000n);
        });

        it('should handle successful transaction (empty revert)', async () => {
            const mockTx = {
                id: Buffer.from('a'.repeat(64), 'hex'),
                hash: Buffer.from('b'.repeat(64), 'hex'),
                blockHeight: { toString: () => '100' },
                index: 0,
                inputs: [],
                outputs: [],
                revert: new Binary(Buffer.alloc(0)),
                OPNetType: OPNetTransactionTypes.Generic,
            };
            mockTxRepo.getTransactionByHash.mockResolvedValue(mockTx);

            const result = await api.getTransaction('txid123');

            expect(result).not.toBeNull();
            expect(result!.receipt).toBeDefined();
            expect(result!.receipt!.success).toBe(true);
            expect(result!.receipt!.revertReason).toBeUndefined();
        });
    });

    describe('script type detection', () => {
        it('should detect P2PKH script', async () => {
            const mockTx = {
                id: Buffer.from('a'.repeat(64), 'hex'),
                hash: Buffer.from('b'.repeat(64), 'hex'),
                blockHeight: { toString: () => '100' },
                index: 0,
                inputs: [],
                outputs: [
                    {
                        value: 1000n,
                        index: 0,
                        scriptPubKey: {
                            hex: '76a914' + 'a'.repeat(40) + '88ac',
                            address: null,
                        },
                    },
                ],
                OPNetType: OPNetTransactionTypes.Generic,
            };
            mockTxRepo.getTransactionByHash.mockResolvedValue(mockTx);

            const result = await api.getTransaction('txid123');

            expect(result!.outputs[0].scriptPubKey.type).toBe('p2pkh');
        });

        it('should detect P2SH script', async () => {
            const mockTx = {
                id: Buffer.from('a'.repeat(64), 'hex'),
                hash: Buffer.from('b'.repeat(64), 'hex'),
                blockHeight: { toString: () => '100' },
                index: 0,
                inputs: [],
                outputs: [
                    {
                        value: 1000n,
                        index: 0,
                        scriptPubKey: {
                            hex: 'a914' + 'a'.repeat(40) + '87',
                            address: null,
                        },
                    },
                ],
                OPNetType: OPNetTransactionTypes.Generic,
            };
            mockTxRepo.getTransactionByHash.mockResolvedValue(mockTx);

            const result = await api.getTransaction('txid123');

            expect(result!.outputs[0].scriptPubKey.type).toBe('p2sh');
        });

        it('should detect P2WPKH script', async () => {
            const mockTx = {
                id: Buffer.from('a'.repeat(64), 'hex'),
                hash: Buffer.from('b'.repeat(64), 'hex'),
                blockHeight: { toString: () => '100' },
                index: 0,
                inputs: [],
                outputs: [
                    {
                        value: 1000n,
                        index: 0,
                        scriptPubKey: {
                            hex: '0014' + 'a'.repeat(40),
                            address: null,
                        },
                    },
                ],
                OPNetType: OPNetTransactionTypes.Generic,
            };
            mockTxRepo.getTransactionByHash.mockResolvedValue(mockTx);

            const result = await api.getTransaction('txid123');

            expect(result!.outputs[0].scriptPubKey.type).toBe('p2wpkh');
        });

        it('should detect P2TR script', async () => {
            const mockTx = {
                id: Buffer.from('a'.repeat(64), 'hex'),
                hash: Buffer.from('b'.repeat(64), 'hex'),
                blockHeight: { toString: () => '100' },
                index: 0,
                inputs: [],
                outputs: [
                    {
                        value: 1000n,
                        index: 0,
                        scriptPubKey: {
                            hex: '5120' + 'a'.repeat(64),
                            address: null,
                        },
                    },
                ],
                OPNetType: OPNetTransactionTypes.Generic,
            };
            mockTxRepo.getTransactionByHash.mockResolvedValue(mockTx);

            const result = await api.getTransaction('txid123');

            expect(result!.outputs[0].scriptPubKey.type).toBe('p2tr');
        });

        it('should detect OP_RETURN script', async () => {
            const mockTx = {
                id: Buffer.from('a'.repeat(64), 'hex'),
                hash: Buffer.from('b'.repeat(64), 'hex'),
                blockHeight: { toString: () => '100' },
                index: 0,
                inputs: [],
                outputs: [
                    {
                        value: 0n,
                        index: 0,
                        scriptPubKey: {
                            hex: '6a' + 'deadbeef',
                            address: null,
                        },
                    },
                ],
                OPNetType: OPNetTransactionTypes.Generic,
            };
            mockTxRepo.getTransactionByHash.mockResolvedValue(mockTx);

            const result = await api.getTransaction('txid123');

            expect(result!.outputs[0].scriptPubKey.type).toBe('op_return');
        });
    });
});
