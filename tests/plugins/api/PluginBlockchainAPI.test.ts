import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Binary } from 'mongodb';
import {
    PluginBlockchainAPI,
    PluginBlockchainError,
} from '../../../src/src/plugins/api/PluginBlockchainAPI.js';
import { IBlockchainPermissions } from '../../../src/src/plugins/interfaces/IPluginPermissions.js';

// Create mock repository instances that will be returned by mocked constructors
const mockBlockRepo = {
    getBlockHeader: vi.fn(),
    getBlockByHash: vi.fn(),
};
const mockTxRepo = {
    getTransactionByHash: vi.fn(),
    getTransactionsByBlockHash: vi.fn(),
};
const mockContractRepo = {
    getContract: vi.fn(),
};
const mockPointerRepo = {
    getByContractAndPointer: vi.fn(),
};
const mockUtxoRepo = {
    getWalletUnspentUTXOS: vi.fn(),
};
const mockBlockchainInfoRepo = {
    getByNetwork: vi.fn(),
};

// Mock all repository modules with class constructors
vi.mock('../../../src/src/db/repositories/BlockRepository.js', () => {
    return {
        BlockRepository: class MockBlockRepository {
            constructor() {
                return mockBlockRepo;
            }
        },
    };
});

vi.mock('../../../src/src/db/repositories/TransactionRepository.js', () => {
    return {
        TransactionRepository: class MockTransactionRepository {
            constructor() {
                return mockTxRepo;
            }
        },
    };
});

vi.mock('../../../src/src/db/repositories/ContractRepository.js', () => {
    return {
        ContractRepository: class MockContractRepository {
            constructor() {
                return mockContractRepo;
            }
        },
    };
});

vi.mock('../../../src/src/db/repositories/ContractPointerValueRepository.js', () => {
    return {
        ContractPointerValueRepository: class MockContractPointerValueRepository {
            constructor() {
                return mockPointerRepo;
            }
        },
    };
});

vi.mock('../../../src/src/db/repositories/UnspentTransactionRepository.js', () => {
    return {
        UnspentTransactionRepository: class MockUnspentTransactionRepository {
            constructor() {
                return mockUtxoRepo;
            }
        },
    };
});

vi.mock('../../../src/src/db/repositories/BlockchainInfoRepository.js', () => {
    return {
        BlockchainInfoRepository: class MockBlockchainInfoRepository {
            constructor() {
                return mockBlockchainInfoRepo;
            }
        },
    };
});

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

describe('PluginBlockchainAPI', () => {
    let api: PluginBlockchainAPI;
    const mockDb = {};

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
        vi.clearAllMocks();

        // Reset mock implementations
        mockBlockRepo.getBlockHeader.mockReset();
        mockBlockRepo.getBlockByHash.mockReset();
        mockTxRepo.getTransactionByHash.mockReset();
        mockTxRepo.getTransactionsByBlockHash.mockReset();
        mockContractRepo.getContract.mockReset();
        mockPointerRepo.getByContractAndPointer.mockReset();
        mockUtxoRepo.getWalletUnspentUTXOS.mockReset();
        mockBlockchainInfoRepo.getByNetwork.mockReset();

        // Set default return values
        mockTxRepo.getTransactionsByBlockHash.mockResolvedValue([]);
        mockUtxoRepo.getWalletUnspentUTXOS.mockResolvedValue({ utxos: [] });
        mockBlockchainInfoRepo.getByNetwork.mockResolvedValue({ inProgressBlock: 100 });

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
            await expect(noBlocksApi.getBlock(100n)).rejects.toThrow('blocks');
        });

        it('should throw when transactions permission is missing', async () => {
            const noTxApi = new PluginBlockchainAPI(
                'test-plugin',
                { ...fullPermissions, transactions: false },
                mockDb as never,
                1,
            );

            await expect(noTxApi.getTransaction('txid123')).rejects.toThrow(PluginBlockchainError);
            await expect(noTxApi.getTransaction('txid123')).rejects.toThrow('transactions');
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
            await expect(noContractApi.getContract('addr123')).rejects.toThrow('contracts');
        });

        it('should throw when utxos permission is missing', async () => {
            const noUtxoApi = new PluginBlockchainAPI(
                'test-plugin',
                { ...fullPermissions, utxos: false },
                mockDb as never,
                1,
            );

            await expect(noUtxoApi.getUTXOs('addr123')).rejects.toThrow(PluginBlockchainError);
            await expect(noUtxoApi.getUTXOs('addr123')).rejects.toThrow('utxos');
        });
    });

    describe('getBlock', () => {
        it('should return null when block not found', async () => {
            mockBlockRepo.getBlockHeader.mockResolvedValue(null);

            const result = await api.getBlock(100n);

            expect(result).toBeNull();
            expect(mockBlockRepo.getBlockHeader).toHaveBeenCalledWith(100n);
        });

        it('should return mapped block header', async () => {
            const mockBlock = createMockBlockHeader(100n);
            mockBlockRepo.getBlockHeader.mockResolvedValue(mockBlock);

            const result = await api.getBlock(100n);

            expect(result).not.toBeNull();
            expect(result?.height).toBe(100n);
            expect(result?.hash).toBe('blockhash123');
            expect(result?.previousHash).toBe('prevhash456');
            expect(result?.merkleRoot).toBe('merkle789');
        });
    });

    describe('getBlockByHash', () => {
        it('should return null when block not found', async () => {
            mockBlockRepo.getBlockByHash.mockResolvedValue(null);

            const result = await api.getBlockByHash('nonexistent');

            expect(result).toBeNull();
            expect(mockBlockRepo.getBlockByHash).toHaveBeenCalledWith('nonexistent');
        });

        it('should return mapped block header', async () => {
            const mockBlock = createMockBlockHeader(100n);
            mockBlockRepo.getBlockByHash.mockResolvedValue(mockBlock);

            const result = await api.getBlockByHash('blockhash123');

            expect(result).not.toBeNull();
            expect(result?.hash).toBe('blockhash123');
        });
    });

    describe('getBlockWithTransactions', () => {
        it('should return null when block not found', async () => {
            mockBlockRepo.getBlockHeader.mockResolvedValue(null);

            const result = await api.getBlockWithTransactions(100n);

            expect(result).toBeNull();
        });

        it('should return block with empty transactions when none exist', async () => {
            const mockBlock = createMockBlockHeader(100n);
            mockBlockRepo.getBlockHeader.mockResolvedValue(mockBlock);
            mockTxRepo.getTransactionsByBlockHash.mockResolvedValue([]);

            const result = await api.getBlockWithTransactions(100n);

            expect(result).not.toBeNull();
            expect(result?.transactions).toEqual([]);
        });

        it('should require blocks permission', async () => {
            const noBlocksApi = new PluginBlockchainAPI(
                'test-plugin',
                { ...fullPermissions, blocks: false },
                mockDb as never,
                1,
            );

            await expect(noBlocksApi.getBlockWithTransactions(100n)).rejects.toThrow('blocks');
        });
    });

    describe('getTransaction', () => {
        it('should return null when transaction not found', async () => {
            mockTxRepo.getTransactionByHash.mockResolvedValue(null);

            const result = await api.getTransaction('txid123');

            expect(result).toBeNull();
        });

        it('should return mapped transaction', async () => {
            const mockTx = {
                id: 'txid123',
                hash: 'txhash456',
                blockHeight: { toString: () => '100' },
                index: 0,
                inputs: [],
                outputs: [],
                burnedBitcoin: { toString: () => '0' },
                OPNetType: 0,
                gasUsed: { toString: () => '21000' },
                events: [],
                // No revert property for successful transaction
            };
            mockTxRepo.getTransactionByHash.mockResolvedValue(mockTx);

            const result = await api.getTransaction('txid123');

            expect(result).not.toBeNull();
            expect(result?.txid).toBe('txid123');
            expect(result?.hash).toBe('txhash456');
        });
    });

    describe('getTransactionsByBlock', () => {
        it('should return empty array when no transactions', async () => {
            mockBlockRepo.getBlockHeader.mockResolvedValue(createMockBlockHeader(100n));
            mockTxRepo.getTransactionsByBlockHash.mockResolvedValue([]);

            const result = await api.getTransactionsByBlock(100n);

            expect(result).toEqual([]);
        });

        it('should return mapped transactions', async () => {
            const mockBlock = createMockBlockHeader(100n);
            mockBlockRepo.getBlockHeader.mockResolvedValue(mockBlock);

            const mockTxs = [
                {
                    id: 'txid1',
                    hash: 'hash1',
                    blockHeight: { toString: () => '100' },
                    index: 0,
                    inputs: [],
                    outputs: [],
                    burnedBitcoin: { toString: () => '0' },
                    OPNetType: 0,
                    gasUsed: { toString: () => '21000' },
                    events: [],
                    // No revert property for successful transaction
                },
            ];
            mockTxRepo.getTransactionsByBlockHash.mockResolvedValue(mockTxs);

            const result = await api.getTransactionsByBlock(100n);

            expect(result).toHaveLength(1);
            expect(result[0].txid).toBe('txid1');
        });
    });

    describe('getContract', () => {
        it('should return null when contract not found', async () => {
            mockContractRepo.getContract.mockResolvedValue(null);

            const result = await api.getContract('addr123');

            expect(result).toBeNull();
        });

        it('should return mapped contract info', async () => {
            const mockContract = {
                contractAddress: 'addr123',
                deployedAtBlock: { toString: () => '100' },
                deployedTransactionId: 'txid456',
                bytecode: new Binary(Buffer.from([0x01, 0x02])),
            };
            mockContractRepo.getContract.mockResolvedValue(mockContract);

            const result = await api.getContract('addr123');

            expect(result).not.toBeNull();
            expect(result?.address).toBe('addr123');
            expect(result?.deploymentHeight).toBe(100n);
        });
    });

    describe('getContractStorage', () => {
        it('should return null when storage value not found', async () => {
            mockPointerRepo.getByContractAndPointer.mockResolvedValue(null);

            const result = await api.getContractStorage('addr123', 0n);

            expect(result).toBeNull();
        });

        it('should return storage value', async () => {
            const mockValue = {
                value: new Binary(Buffer.from([0xde, 0xad, 0xbe, 0xef])),
            };
            mockPointerRepo.getByContractAndPointer.mockResolvedValue(mockValue);

            const result = await api.getContractStorage('addr123', 0n);

            expect(result).not.toBeNull();
            expect(result).toBeInstanceOf(Buffer);
        });
    });

    describe('getContractEvents', () => {
        it('should throw not implemented error', async () => {
            await expect(api.getContractEvents('addr123', 'Transfer')).rejects.toThrow(
                'Not implemented',
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
            const mockUtxos = {
                utxos: [
                    {
                        transactionId: 'txid123',
                        outputIndex: 0,
                        value: { toString: () => '50000' },
                        scriptPubKey: {
                            hex: 'scriptpubkeyhex',
                            address: 'addr123',
                        },
                    },
                ],
            };
            mockUtxoRepo.getWalletUnspentUTXOS.mockResolvedValue(mockUtxos);

            const result = await api.getUTXOs('addr123');

            expect(result).toHaveLength(1);
            expect(result[0].txid).toBe('txid123');
            expect(result[0].vout).toBe(0);
            expect(result[0].value).toBe(50000n);
        });
    });

    describe('getChainTip', () => {
        it('should return current chain tip', async () => {
            mockBlockchainInfoRepo.getByNetwork.mockResolvedValue({ inProgressBlock: 150 });

            const result = await api.getChainTip();

            expect(result).toBe(150n);
        });

        it('should return 0 when no chain info', async () => {
            mockBlockchainInfoRepo.getByNetwork.mockResolvedValue(null);

            const result = await api.getChainTip();

            expect(result).toBe(0n);
        });

        it('should not require specific permissions', async () => {
            const minPermsApi = new PluginBlockchainAPI(
                'test-plugin',
                { blocks: false, transactions: false, contracts: false, utxos: false },
                mockDb as never,
                1,
            );
            mockBlockchainInfoRepo.getByNetwork.mockResolvedValue({ inProgressBlock: 100 });

            const result = await minPermsApi.getChainTip();

            expect(result).toBe(100n);
        });
    });

    describe('getBlockRange', () => {
        it('should return blocks in range', async () => {
            const mockBlock = createMockBlockHeader(100n);
            mockBlockRepo.getBlockHeader.mockResolvedValue(mockBlock);

            const result = await api.getBlockRange(100n, 102n);

            expect(result.length).toBeGreaterThanOrEqual(1);
        });

        it('should limit range to 100 blocks', async () => {
            const mockBlock = createMockBlockHeader(100n);
            mockBlockRepo.getBlockHeader.mockResolvedValue(mockBlock);

            const result = await api.getBlockRange(0n, 200n);

            // Should be capped at 100 blocks
            expect(mockBlockRepo.getBlockHeader).toHaveBeenCalledTimes(100);
        });

        it('should skip missing blocks', async () => {
            mockBlockRepo.getBlockHeader
                .mockResolvedValueOnce(createMockBlockHeader(100n))
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(createMockBlockHeader(102n));

            const result = await api.getBlockRange(100n, 103n);

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
            mockBlockRepo.getBlockHeader.mockResolvedValue(null);

            const result = await api.hasBlock(100n);

            expect(result).toBe(false);
        });
    });

    describe('transaction mapping', () => {
        it('should handle Binary inputs correctly', async () => {
            const mockTx = {
                id: 'txid123',
                hash: 'txhash456',
                blockHeight: { toString: () => '100' },
                index: 0,
                inputs: [
                    {
                        originalTransactionId: 'input-txid',
                        outputIndex: 0,
                        scriptSig: new Binary(Buffer.from([0x01, 0x02])),
                        witness: [new Binary(Buffer.from([0x03, 0x04]))],
                    },
                ],
                outputs: [
                    {
                        value: { toString: () => '1000' },
                        index: 0,
                        scriptPubKey: {
                            hex: '76a914...',
                            address: 'addr123',
                        },
                    },
                ],
                burnedBitcoin: { toString: () => '0' },
                OPNetType: 0,
                gasUsed: { toString: () => '21000' },
                events: [],
                // No revert property for successful transaction
            };
            mockTxRepo.getTransactionByHash.mockResolvedValue(mockTx);

            const result = await api.getTransaction('txid123');

            expect(result).not.toBeNull();
            expect(result?.inputs).toHaveLength(1);
            expect(result?.inputs[0].txid).toBe('input-txid');
        });

        it('should handle revert data correctly', async () => {
            const revertBuffer = Buffer.from('Revert reason');
            const mockTx = {
                id: 'txid123',
                hash: 'txhash456',
                blockHeight: { toString: () => '100' },
                index: 0,
                inputs: [],
                outputs: [],
                burnedBitcoin: { toString: () => '0' },
                OPNetType: 0,
                gasUsed: { toString: () => '21000' },
                events: [],
                revert: new Binary(revertBuffer),
            };
            mockTxRepo.getTransactionByHash.mockResolvedValue(mockTx);

            const result = await api.getTransaction('txid123');

            expect(result).not.toBeNull();
            expect(result?.receipt?.success).toBe(false);
            expect(result?.receipt?.revertReason).toContain('Revert');
        });

        it('should handle successful transaction (no revert)', async () => {
            const mockTx = {
                id: 'txid123',
                hash: 'txhash456',
                blockHeight: { toString: () => '100' },
                index: 0,
                inputs: [],
                outputs: [],
                burnedBitcoin: { toString: () => '0' },
                OPNetType: 0,
                gasUsed: { toString: () => '21000' },
                events: [],
                // No revert property means successful
            };
            mockTxRepo.getTransactionByHash.mockResolvedValue(mockTx);

            const result = await api.getTransaction('txid123');

            expect(result).not.toBeNull();
            // Receipt may be undefined for successful transactions
            expect(result?.receipt?.success).not.toBe(false);
        });
    });

    describe('script type detection', () => {
        const createOutputWithScript = (hex: string) => ({
            id: 'txid123',
            hash: 'txhash456',
            blockHeight: { toString: () => '100' },
            index: 0,
            inputs: [],
            outputs: [
                {
                    value: { toString: () => '1000' },
                    index: 0,
                    scriptPubKey: {
                        hex,
                        address: 'addr123',
                    },
                },
            ],
            burnedBitcoin: { toString: () => '0' },
            OPNetType: 0,
            gasUsed: { toString: () => '21000' },
            events: [],
            // No revert property
        });

        it('should detect P2PKH script', async () => {
            // P2PKH: OP_DUP OP_HASH160 <20 bytes> OP_EQUALVERIFY OP_CHECKSIG
            const p2pkhScript = '76a914' + '00'.repeat(20) + '88ac';
            mockTxRepo.getTransactionByHash.mockResolvedValue(createOutputWithScript(p2pkhScript));

            const result = await api.getTransaction('txid123');

            expect(result?.outputs[0].scriptPubKey.type).toBe('p2pkh');
        });

        it('should detect P2SH script', async () => {
            // P2SH: OP_HASH160 <20 bytes> OP_EQUAL
            const p2shScript = 'a914' + '00'.repeat(20) + '87';
            mockTxRepo.getTransactionByHash.mockResolvedValue(createOutputWithScript(p2shScript));

            const result = await api.getTransaction('txid123');

            expect(result?.outputs[0].scriptPubKey.type).toBe('p2sh');
        });

        it('should detect P2WPKH script', async () => {
            // P2WPKH: OP_0 <20 bytes>
            const p2wpkhScript = '0014' + '00'.repeat(20);
            mockTxRepo.getTransactionByHash.mockResolvedValue(createOutputWithScript(p2wpkhScript));

            const result = await api.getTransaction('txid123');

            expect(result?.outputs[0].scriptPubKey.type).toBe('p2wpkh');
        });

        it('should detect P2TR script', async () => {
            // P2TR: OP_1 <32 bytes>
            const p2trScript = '5120' + '00'.repeat(32);
            mockTxRepo.getTransactionByHash.mockResolvedValue(createOutputWithScript(p2trScript));

            const result = await api.getTransaction('txid123');

            expect(result?.outputs[0].scriptPubKey.type).toBe('p2tr');
        });

        it('should detect OP_RETURN script', async () => {
            // OP_RETURN: 6a followed by data
            const opReturnScript = '6a04deadbeef';
            mockTxRepo.getTransactionByHash.mockResolvedValue(
                createOutputWithScript(opReturnScript),
            );

            const result = await api.getTransaction('txid123');

            expect(result?.outputs[0].scriptPubKey.type).toBe('op_return');
        });
    });
});
