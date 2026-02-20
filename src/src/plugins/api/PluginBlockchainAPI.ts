import { Binary, Db } from 'mongodb';
import { DataConverter } from '@btc-vision/bsi-common';
import { fromHex, toHex } from '@btc-vision/bitcoin';
import { Address } from '@btc-vision/transaction';
import { BlockRepository } from '../../db/repositories/BlockRepository.js';
import { TransactionRepository } from '../../db/repositories/TransactionRepository.js';
import { ContractRepository } from '../../db/repositories/ContractRepository.js';
import { ContractPointerValueRepository } from '../../db/repositories/ContractPointerValueRepository.js';
import { UnspentTransactionRepository } from '../../db/repositories/UnspentTransactionRepository.js';
import { BlockchainInfoRepository } from '../../db/repositories/BlockchainInfoRepository.js';
import { IBlockchainPermissions } from '../interfaces/IPluginPermissions.js';
import { OPNetTransactionTypes } from '../../blockchain-indexer/processor/transaction/enums/OPNetTransactionTypes.js';
import { Config } from '../../config/Config.js';

/**
 * Block header information for plugins
 */
export interface IBlockHeader {
    readonly height: bigint;
    readonly hash: string;
    readonly previousHash: string;
    readonly merkleRoot: string;
    readonly timestamp: number;
    readonly receiptRoot: string;
    readonly storageRoot: string;
    readonly checksumHash: string;
}

/**
 * Transaction input for plugins
 */
export interface ITransactionInput {
    readonly txid: string;
    readonly vout: number;
    readonly scriptSig?: {
        readonly asm: string;
        readonly hex: string;
    };
    readonly txinwitness?: readonly string[];
    readonly sequence: number;
}

/**
 * Transaction output for plugins
 */
export interface ITransactionOutput {
    readonly value: bigint;
    readonly n: number;
    readonly scriptPubKey: {
        readonly asm: string;
        readonly hex: string;
        readonly type: string;
        readonly address?: string;
        readonly addresses?: readonly string[];
    };
}

/**
 * Transaction document for plugins
 */
export interface ITransactionDocument {
    readonly txid: string;
    readonly hash: string;
    readonly blockHeight: bigint;
    readonly index: number;
    readonly inputs: readonly ITransactionInput[];
    readonly outputs: readonly ITransactionOutput[];
    readonly gasUsed?: bigint;
    readonly receipt?: ITransactionReceipt;
}

/**
 * Contract event for plugins
 */
export interface IContractEvent {
    readonly contractAddress: string;
    readonly eventType: string;
    readonly data: Uint8Array;
    readonly blockHeight: bigint;
    readonly txid: string;
    readonly eventIndex: number;
}

/**
 * Transaction receipt for plugins
 */
export interface ITransactionReceipt {
    readonly success: boolean;
    readonly gasUsed: bigint;
    readonly events: readonly IContractEvent[];
    readonly revertReason?: string;
    readonly returnData?: Uint8Array;
}

/**
 * Contract info for plugins
 */
export interface IContractInfo {
    readonly address: string;
    readonly deploymentHeight: bigint;
    readonly deploymentTxid: string;
    readonly bytecode?: Uint8Array;
    readonly deployer?: string;
    readonly isActive: boolean;
}

/**
 * UTXO for plugins
 */
export interface IUTXO {
    readonly txid: string;
    readonly vout: number;
    readonly value: bigint;
    readonly scriptPubKey: string;
    readonly scriptType?: string;
    readonly address?: string;
    readonly blockHeight: bigint;
    readonly confirmed: boolean;
    readonly confirmations?: number;
}

/**
 * Block with transactions for plugins
 */
export interface IBlockWithTransactions extends IBlockHeader {
    readonly transactions: readonly ITransactionDocument[];
}

/**
 * Plugin blockchain API interface
 */
export interface IPluginBlockchainAPI {
    getBlock(height: bigint): Promise<IBlockHeader | null>;
    getBlockByHash(hash: string): Promise<IBlockHeader | null>;
    getBlockWithTransactions(height: bigint): Promise<IBlockWithTransactions | null>;
    getTransaction(txid: string): Promise<ITransactionDocument | null>;
    getTransactionsByBlock(height: bigint): Promise<readonly ITransactionDocument[]>;
    getContract(address: string): Promise<IContractInfo | null>;
    getContractStorage(address: string, pointer: bigint): Promise<Uint8Array | null>;
    getContractEvents(
        address: string,
        fromBlock: bigint,
        toBlock: bigint,
    ): Promise<readonly IContractEvent[]>;
    getUTXOs(address: string): Promise<readonly IUTXO[]>;
    getChainTip(): Promise<bigint>;
    getBlockRange(fromHeight: bigint, toHeight: bigint): Promise<readonly IBlockHeader[]>;
    hasBlock(height: bigint): Promise<boolean>;
}

/**
 * Plugin blockchain API error
 */
export class PluginBlockchainError extends Error {
    constructor(
        message: string,
        public readonly code: string,
    ) {
        super(message);
        this.name = 'PluginBlockchainError';
    }
}

/**
 * Plugin Blockchain API Implementation
 * Provides read-only access to blockchain data for plugins
 */
export class PluginBlockchainAPI implements IPluginBlockchainAPI {
    private readonly blockRepo: BlockRepository;
    private readonly txRepo: TransactionRepository;
    private readonly contractRepo: ContractRepository;
    private readonly pointerRepo: ContractPointerValueRepository;
    private readonly utxoRepo: UnspentTransactionRepository;
    private readonly blockchainInfoRepo: BlockchainInfoRepository;

    constructor(
        private readonly pluginId: string,
        private readonly permissions: IBlockchainPermissions,
        db: Db,
        dbVersion: number,
    ) {
        this.blockRepo = new BlockRepository(db);
        this.txRepo = new TransactionRepository(db);
        this.contractRepo = new ContractRepository(db);
        this.pointerRepo = new ContractPointerValueRepository(db);
        this.utxoRepo = new UnspentTransactionRepository(db, dbVersion);
        this.blockchainInfoRepo = new BlockchainInfoRepository(db);
    }

    /**
     * Get a block header by height
     */
    public async getBlock(height: bigint): Promise<IBlockHeader | null> {
        this.checkPermission('blocks');

        const block = await this.blockRepo.getBlockHeader(height);
        if (!block) {
            return null;
        }

        return this.mapBlockHeader(block);
    }

    /**
     * Get a block header by hash
     */
    public async getBlockByHash(hash: string): Promise<IBlockHeader | null> {
        this.checkPermission('blocks');

        const block = await this.blockRepo.getBlockByHash(hash, false);
        if (!block) {
            return null;
        }

        return this.mapBlockHeader(block);
    }

    /**
     * Get a block with all its transactions
     */
    public async getBlockWithTransactions(height: bigint): Promise<IBlockWithTransactions | null> {
        this.checkPermission('blocks');
        this.checkPermission('transactions');

        const block = await this.blockRepo.getBlockHeader(height);
        if (!block) {
            return null;
        }

        const blockHeader = this.mapBlockHeader(block);
        const transactions = await this.getTransactionsByBlock(height);

        return {
            ...blockHeader,
            transactions,
        };
    }

    /**
     * Get a transaction by its ID
     */
    public async getTransaction(txid: string): Promise<ITransactionDocument | null> {
        this.checkPermission('transactions');

        const tx = await this.txRepo.getTransactionByHash(txid);
        if (!tx) {
            return null;
        }

        return this.mapTransaction(tx);
    }

    /**
     * Get all transactions in a specific block
     */
    public async getTransactionsByBlock(height: bigint): Promise<readonly ITransactionDocument[]> {
        this.checkPermission('transactions');

        const heightDecimal = DataConverter.toDecimal128(height);
        const transactions = await this.txRepo.getTransactionsByBlockHash(heightDecimal);

        return transactions.map((tx) => this.mapTransaction(tx));
    }

    /**
     * Get contract information by address
     */
    public async getContract(address: string): Promise<IContractInfo | null> {
        this.checkPermission('contracts');

        const contract = await this.contractRepo.getContract(address);
        if (!contract) {
            return null;
        }

        return {
            address: contract.contractAddress,
            deploymentHeight: contract.blockHeight,
            deploymentTxid: toHex(contract.deployedTransactionId),
            bytecode: contract.bytecode,
            deployer: contract.deployerAddress.toString(),
            isActive: true,
        };
    }

    /**
     * Get contract storage value at a specific pointer
     */
    public async getContractStorage(address: string, pointer: bigint): Promise<Uint8Array | null> {
        this.checkPermission('contracts');

        const contractAddress = Address.fromString(address);
        const pointerBytes = this.bigintToPointer(pointer);

        const result = await this.pointerRepo.getByContractAndPointer(
            contractAddress,
            pointerBytes,
        );
        if (!result) {
            return null;
        }

        return new Uint8Array(result.value);
    }

    /**
     * Get contract events for a specific address within a block range
     * Note: Full event querying would require an events repository which does not exist yet.
     */
    public getContractEvents(
        _address: string,
        _fromBlock: bigint,
        _toBlock: bigint,
    ): Promise<readonly IContractEvent[]> {
        this.checkPermission('contracts');

        throw new PluginBlockchainError(
            `Event querying is not implemented yet.`,
            `BLOCKCHAIN_EVENTS_NOT_IMPLEMENTED`,
        );

        // TODO: Implement event querying when events repository is available
    }

    /**
     * Get UTXOs for an address
     */
    public async getUTXOs(address: string): Promise<readonly IUTXO[]> {
        this.checkPermission('utxos');

        const result = await this.utxoRepo.getWalletUnspentUTXOS(address, false, undefined);

        const chainTip = await this.getChainTipInternal();

        return result.utxos.map((utxo) => {
            const blockHeight = BigInt(utxo.scriptPubKey.address ? 0 : 0); // UTXO repo doesn't return blockHeight directly
            return {
                txid: utxo.transactionId,
                vout: utxo.outputIndex,
                value: utxo.value,
                scriptPubKey: utxo.scriptPubKey.hex,
                address: utxo.scriptPubKey.address,
                blockHeight,
                confirmed: true,
                confirmations: Number(chainTip - blockHeight),
            };
        });
    }

    /**
     * Get the current chain tip (highest block height)
     */
    public async getChainTip(): Promise<bigint> {
        // No permission check needed - basic chain info
        return this.getChainTipInternal();
    }

    /**
     * Get multiple blocks by height range
     */
    public async getBlockRange(
        fromHeight: bigint,
        toHeight: bigint,
    ): Promise<readonly IBlockHeader[]> {
        this.checkPermission('blocks');

        const blocks: IBlockHeader[] = [];

        // Limit range to prevent excessive queries
        const maxRange = 100n;
        const actualToHeight = toHeight - fromHeight > maxRange ? fromHeight + maxRange : toHeight;

        for (let h = fromHeight; h <= actualToHeight; h++) {
            const block = await this.blockRepo.getBlockHeader(h);
            if (block) {
                blocks.push(this.mapBlockHeader(block));
            }
        }

        return blocks;
    }

    /**
     * Check if a block exists at the given height
     */
    public async hasBlock(height: bigint): Promise<boolean> {
        this.checkPermission('blocks');

        const block = await this.blockRepo.getBlockHeader(height);
        return block != null;
    }

    /**
     * Check if the plugin has the required permission
     */
    private checkPermission(type: keyof IBlockchainPermissions): void {
        if (!this.permissions[type]) {
            throw new PluginBlockchainError(
                `Plugin "${this.pluginId}" does not have blockchain.${type} permission`,
                `BLOCKCHAIN_${type.toUpperCase()}_NOT_PERMITTED`,
            );
        }
    }

    /**
     * Get chain tip without permission check (internal use)
     */
    private async getChainTipInternal(): Promise<bigint> {
        const info = await this.blockchainInfoRepo.getByNetwork(Config.BITCOIN.NETWORK);
        return BigInt(info?.inProgressBlock || 0);
    }

    /**
     * Map a block document to the plugin-friendly format
     */
    private mapBlockHeader(block: {
        height?: { toString(): string };
        hash: string;
        previousBlockHash: string;
        merkleRoot: string;
        time: Date;
        receiptRoot: string;
        storageRoot: string;
        checksumRoot: string;
    }): IBlockHeader {
        return {
            height: BigInt(block.height?.toString() ?? '0'),
            hash: block.hash,
            previousHash: block.previousBlockHash,
            merkleRoot: block.merkleRoot,
            timestamp: Math.floor(block.time.getTime() / 1000),
            receiptRoot: block.receiptRoot,
            storageRoot: block.storageRoot,
            checksumHash: block.checksumRoot,
        };
    }

    /**
     * Map a transaction document to the plugin-friendly format
     */
    private mapTransaction(tx: {
        id?: Binary | Uint8Array;
        hash?: Binary | Uint8Array;
        blockHeight?: { toString(): string };
        index: number;
        inputs: Array<{
            originalTransactionId?: Binary | Uint8Array;
            outputTransactionIndex?: number;
            sequence?: number;
        }>;
        outputs: Array<{
            value?: bigint | { toString(): string };
            index: number;
            scriptPubKey: {
                hex: string | Binary;
                address?: string | null;
                addresses?: readonly string[] | null;
            };
        }>;
        gasUsed?: { toString(): string };
        revert?: Binary;
        OPNetType: OPNetTransactionTypes;
    }): ITransactionDocument {
        const inputs: ITransactionInput[] = tx.inputs.map((input) => {
            let txid = '0000000000000000000000000000000000000000000000000000000000000000';
            if (input.originalTransactionId) {
                const bytes =
                    input.originalTransactionId instanceof Binary
                        ? new Uint8Array(input.originalTransactionId.buffer)
                        : input.originalTransactionId;
                txid = toHex(bytes);
            }
            return {
                txid,
                vout: input.outputTransactionIndex ?? 0,
                sequence: input.sequence ?? 0xffffffff,
            };
        });

        const outputs: ITransactionOutput[] = tx.outputs.map((output) => {
            const hexValue =
                output.scriptPubKey.hex instanceof Binary
                    ? toHex(new Uint8Array(output.scriptPubKey.hex.buffer))
                    : output.scriptPubKey.hex;
            return {
                value:
                    typeof output.value === 'bigint'
                        ? output.value
                        : BigInt(output.value?.toString() ?? '0'),
                n: output.index,
                scriptPubKey: {
                    asm: '',
                    hex: hexValue,
                    type: this.getScriptType(hexValue),
                    address: output.scriptPubKey.address ?? undefined,
                    addresses: output.scriptPubKey.addresses ?? undefined,
                },
            };
        });

        const gasUsed = tx.gasUsed ? BigInt(tx.gasUsed.toString()) : undefined;

        let receipt: ITransactionReceipt | undefined;
        if (tx.revert !== undefined) {
            const revertBytes = new Uint8Array(tx.revert.buffer);
            receipt = {
                success: revertBytes.length === 0,
                gasUsed: gasUsed ?? 0n,
                events: [],
                revertReason:
                    revertBytes.length > 0 ? new TextDecoder().decode(revertBytes) : undefined,
            };
        }

        // Convert id and hash from Binary/Uint8Array to hex string
        let txidHex = '';
        if (tx.id) {
            const idBytes = tx.id instanceof Binary ? new Uint8Array(tx.id.buffer) : tx.id;
            txidHex = toHex(idBytes);
        }

        let hashHex = '';
        if (tx.hash) {
            const hashBytes = tx.hash instanceof Binary ? new Uint8Array(tx.hash.buffer) : tx.hash;
            hashHex = toHex(hashBytes);
        }

        return {
            txid: txidHex,
            hash: hashHex,
            blockHeight: BigInt(tx.blockHeight?.toString() ?? '0'),
            index: tx.index,
            inputs,
            outputs,
            gasUsed,
            receipt,
        };
    }

    /**
     * Determine script type from hex
     */
    private getScriptType(hex: string): string {
        if (!hex) return 'unknown';

        // Simple heuristic based on script patterns
        if (hex.startsWith('76a914') && hex.endsWith('88ac')) {
            return 'p2pkh';
        } else if (hex.startsWith('a914') && hex.endsWith('87')) {
            return 'p2sh';
        } else if (hex.startsWith('0014') && hex.length === 44) {
            return 'p2wpkh';
        } else if (hex.startsWith('0020') && hex.length === 68) {
            return 'p2wsh';
        } else if (hex.startsWith('5120') && hex.length === 68) {
            return 'p2tr';
        } else if (hex.startsWith('6a')) {
            return 'op_return';
        }

        return 'unknown';
    }

    /**
     * Convert bigint to storage pointer bytes
     */
    private bigintToPointer(value: bigint): Uint8Array {
        const hex = value.toString(16).padStart(64, '0');
        return fromHex(hex);
    }
}
