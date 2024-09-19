import { BitcoinRPC, BlockHeaderInfo } from '@btc-vision/bsi-bitcoin-rpc';
import { Block } from '../block/Block.js';
import { VMStorage } from '../../../vm/storage/VMStorage.js';
import { VMManager } from '../../../vm/VMManager.js';
import { Logger } from '@btc-vision/bsi-common';
import { IndexingTask } from '../tasks/IndexingTask.js';
import { BlockHeaderBlockDocument } from '../../../db/interfaces/IBlockHeaderBlockDocument.js';

interface LastBlock {
    hash?: string;
    checksum?: string;
    blockNumber?: bigint;

    opnetBlock?: BlockHeaderBlockDocument;
}

interface HeaderInfo {
    blockNumber: bigint;
    blockHash: string;
    previousBlockHash: string;
}

export class ReorgWatchdog extends Logger {
    public readonly logColor: string = '#e2ef37';

    private readonly reorgListeners: Array<
        (fromHeight: bigint, toHeight: bigint, newBest: string) => Promise<void>
    > = [];

    private lastBlock: LastBlock = {};

    constructor(
        private readonly vmStorage: VMStorage,
        private readonly vmManager: VMManager,
        private readonly rpcClient: BitcoinRPC,
        //private readonly chainObserver: ChainObserver,
        //private readonly consensusTracker: ConsensusTracker,
    ) {
        super();
    }

    public get pendingBlockHeight(): bigint {
        if (this.lastBlock.blockNumber === undefined) {
            throw new Error('Last block number is not set');
        }

        return this.lastBlock.blockNumber;
    }

    private _currentHeader: HeaderInfo | null = null;

    private get currentHeader(): HeaderInfo {
        if (!this._currentHeader) {
            throw new Error('Current header is not set');
        }

        return this._currentHeader;
    }

    public onBlockChange(header: BlockHeaderInfo): void {
        this._currentHeader = {
            blockNumber: BigInt(header.height),
            blockHash: header.hash,
            previousBlockHash: header.previousblockhash,
        };
    }

    public async init(currentHeight: bigint): Promise<void> {
        const blockHash = await this.rpcClient.getBlockHash(Number(currentHeight));
        if (!blockHash) throw new Error(`Error fetching block hash for block ${currentHeight}.`);

        const latestBlockHeader = await this.rpcClient.getBlockHeader(blockHash);
        if (!latestBlockHeader)
            throw new Error(`Error fetching block header for block ${currentHeight}.`);

        this._currentHeader = {
            blockNumber: currentHeight,
            blockHash: blockHash,
            previousBlockHash: latestBlockHeader.previousblockhash,
        };

        if (currentHeight - 1n === -1n) {
            this.lastBlock = {
                blockNumber: -1n,
            };

            return;
        }

        const height = currentHeight - 1n;
        const lastBlock = await this.vmStorage.getBlockHeader(height);
        if (!lastBlock) {
            this.error(`Database corrupted. Attempting to restore from block ${height}.`);

            return this.init(height);
        }

        this.lastBlock = {
            blockNumber: currentHeight,
            hash: lastBlock.hash,
            checksum: lastBlock.checksumRoot,
            opnetBlock: lastBlock,
        };
    }

    public subscribeToReorgs(
        cb: (fromHeight: bigint, toHeight: bigint, newBest: string) => Promise<void>,
    ): void {
        this.reorgListeners.push(cb);
    }

    public async verifyChainReorgForBlock(task: IndexingTask): Promise<boolean> {
        const syncBlockDiff = this.currentHeader.blockNumber - task.tip;
        if (syncBlockDiff >= 100) {
            this.updateBlock(task.block);

            return false;
        }

        const chainReorged: boolean = await this.verifyChainReorg(task.block);
        if (!chainReorged) {
            this.updateBlock(task.block);

            return false;
        }

        await this.restoreBlockchain(task.tip);

        return true;
    }

    private updateBlock(block: Block): void {
        this.lastBlock = {
            hash: block.hash,
            checksum: block.checksumRoot,
            blockNumber: block.height,
            opnetBlock: block.getBlockHeaderDocument(),
        };
    }

    /**
     * We must find the last known good block to revert to.
     */
    private async revertToLastGoodBlock(height: bigint): Promise<bigint> {
        let shouldContinue: boolean = true;
        let previousBlock: bigint = height;

        do {
            previousBlock--;

            if (previousBlock < 0) {
                this.error(`Can not revert to a block lower than 0. GENESIS block reached.`);

                return 0n;
            }

            const promises: [
                Promise<string | null>,
                Promise<BlockHeaderBlockDocument | undefined>,
            ] = [
                this.rpcClient.getBlockHash(Number(previousBlock)),
                this.vmStorage.getBlockHeader(previousBlock),
            ];

            const results = await Promise.all(promises);

            const currentBlockHash: string | null = results[0];
            if (currentBlockHash === null) {
                throw new Error(`Error fetching block hash.`);
            }

            const savedBlockHeader: BlockHeaderBlockDocument | undefined = results[1];
            if (!savedBlockHeader) {
                throw new Error(`Error fetching block header.`);
            }

            if (savedBlockHeader.hash === currentBlockHash) {
                shouldContinue = false;
                this.success(`Validated headers for block ${previousBlock}... (GOOD)`);
            } else {
                this.fail(`Validated headers for block ${previousBlock}... (BAD)`);
            }
        } while (shouldContinue);

        do {
            const opnetHeaders = await this.vmStorage.getBlockHeader(previousBlock);

            if (!opnetHeaders) {
                this.warn(`No OPNet headers found for block ${previousBlock}.`);
                break;
            }

            try {
                const verifiedProofs: boolean =
                    await this.vmManager.validateBlockChecksum(opnetHeaders);

                if (verifiedProofs) {
                    this.success(`Validated checksum proofs for block ${previousBlock}... (GOOD)`);
                    break;
                } else {
                    this.fail(`Validated checksum proofs for block ${previousBlock}... (BAD)`);
                }
            } catch (e) {
                this.fail(`Validated checksum proofs for block ${previousBlock}... (BAD)`);
            }
        } while (previousBlock-- > 0);

        return previousBlock;
    }

    private async restoreBlockchain(tip: bigint): Promise<void> {
        const lastGoodBlock: bigint = await this.revertToLastGoodBlock(tip);
        const lastGoodBlockHeader = await this.vmStorage.getBlockHeader(lastGoodBlock);

        if (!lastGoodBlockHeader) {
            throw new Error(`Error fetching last good block header.`);
        }

        this.lastBlock = {};

        this.info(`OPNet will automatically revert to block ${lastGoodBlock}.`);

        await this.notifyReorgListeners(lastGoodBlock + 1n, tip, lastGoodBlockHeader.hash);
    }

    private async getLastBlockHash(height: bigint): Promise<LastBlock | undefined> {
        if (height === -1n) {
            return;
        } else if (this.lastBlock.hash && this.lastBlock.checksum) {
            return {
                hash: this.lastBlock.hash,
                checksum: this.lastBlock.checksum,
                opnetBlock: this.lastBlock.opnetBlock,
            };
        }

        const previousBlock = await this.vmManager.getBlockHeader(height);
        if (!previousBlock) {
            throw new Error(
                `Error fetching previous block hash. Can not verify chain reorg. Block height: ${height}`,
            );
        }

        return {
            blockNumber: height,
            hash: previousBlock.hash,
            checksum: previousBlock.checksumRoot,
            opnetBlock: previousBlock,
        };
    }

    private async verifyChainReorg(block: Block): Promise<boolean> {
        const previousBlock = block.height - 1n;
        if (previousBlock <= 0n) {
            return false; // Genesis block reached.
        }

        const previous = await this.getLastBlockHash(previousBlock);
        const opnetBlock = previous?.opnetBlock;

        if (!opnetBlock || !previous) {
            throw new Error(
                `Error fetching previous block hash. Can not verify chain reorg. Block height: ${previousBlock}`,
            );
        }

        // Verify if the previous block hash is the same as the current block's previous block hash.
        const bitcoinReorged = block.previousBlockHash !== previous.hash;
        if (bitcoinReorged) return bitcoinReorged;

        // Verify opnet checksum proofs.
        try {
            const verifiedProofs: boolean = await this.vmManager.validateBlockChecksum(opnetBlock);
            if (block.previousBlockChecksum) {
                const opnetBadChecksum = opnetBlock.checksumRoot !== block.previousBlockChecksum;

                return opnetBadChecksum || !verifiedProofs;
            }

            return !verifiedProofs;
        } catch (e) {
            this.panic(`Error validating block checksum: ${e}`);
            return true;
        }
    }

    private async notifyReorgListeners(
        fromHeight: bigint,
        toHeight: bigint,
        newBest: string,
    ): Promise<void> {
        for (const listener of this.reorgListeners) {
            await listener(fromHeight, toHeight, newBest);
        }
    }
}
