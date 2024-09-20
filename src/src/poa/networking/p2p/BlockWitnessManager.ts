import { DebugLevel, Logger } from '@btc-vision/bsi-common';
import Long from 'long';
import { BitcoinRPCThreadMessageType } from '../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { BtcIndexerConfig } from '../../../config/BtcIndexerConfig.js';
import { DBManagerInstance } from '../../../db/DBManager.js';
import { BlockHeaderBlockDocument } from '../../../db/interfaces/IBlockHeaderBlockDocument.js';
import { IParsedBlockWitnessDocument } from '../../../db/models/IBlockWitnessDocument.js';
import { BlockRepository } from '../../../db/repositories/BlockRepository.js';
import { BlockWitnessRepository } from '../../../db/repositories/BlockWitnessRepository.js';
import { MessageType } from '../../../threading/enum/MessageType.js';
import { RPCMessageData } from '../../../threading/interfaces/thread-messages/messages/api/RPCMessage.js';
import {
    ValidateBlockHeaders,
    ValidatedBlockHeader,
} from '../../../threading/interfaces/thread-messages/messages/api/ValidateBlockHeaders.js';
import { BlockProcessedData } from '../../../threading/interfaces/thread-messages/messages/indexer/BlockProcessed.js';
import {
    BlockProcessedMessage,
    CurrentIndexerBlockResponseData,
} from '../../../threading/interfaces/thread-messages/messages/indexer/CurrentIndexerBlock.js';
import { ThreadMessageBase } from '../../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../../../threading/interfaces/ThreadData.js';
import { ThreadTypes } from '../../../threading/thread/enums/ThreadTypes.js';
import { OPNetIdentity } from '../../identity/OPNetIdentity.js';
import {
    IBlockHeaderWitness,
    OPNetBlockWitness,
} from '../protobuf/packets/blockchain/common/BlockHeaderWitness.js';
import { ISyncBlockHeaderResponse } from '../protobuf/packets/blockchain/responses/SyncBlockHeadersResponse.js';
import { OPNetConsensus } from '../../configurations/OPNetConsensus.js';

interface ValidWitnesses {
    validTrustedWitnesses: OPNetBlockWitness[];
    opnetWitnesses: OPNetBlockWitness[];
}

/** TODO: We should move this class in it's own thread in the future for better performance */
export class BlockWitnessManager extends Logger {
    public readonly logColor: string = '#00ffe1';

    /** How many blocks we can store in memory before we start rejecting witnesses */
    private readonly pendingBlockThreshold: bigint = 24n;
    private readonly maxPendingWitnesses: number = 50;

    private pendingWitnessesVerification: Map<bigint, IBlockHeaderWitness[]> = new Map();
    private currentBlock: bigint = -1n;

    private blockWitnessRepository: BlockWitnessRepository | undefined;
    private blockHeaderRepository: BlockRepository | undefined;
    private knownTrustedWitnesses: Map<bigint, string[]> = new Map();

    private MAXIMUM_WITNESSES_PER_MESSAGE: number = 20;

    constructor(
        private readonly config: BtcIndexerConfig,
        private readonly identity: OPNetIdentity,
    ) {
        super();

        this.pendingBlockThreshold = BigInt(this.config.OP_NET.PENDING_BLOCK_THRESHOLD) || 10n;

        setInterval(() => {
            this.purgeOldWitnesses();
        }, 30000);
    }

    public init(): void {
        if (!DBManagerInstance.db) throw new Error('Database not initialized.');

        this.blockWitnessRepository = new BlockWitnessRepository(DBManagerInstance.db);
        this.blockHeaderRepository = new BlockRepository(DBManagerInstance.db);
    }

    public async onBlockWitnessResponse(packet: ISyncBlockHeaderResponse): Promise<void> {
        if (!this.blockHeaderRepository) {
            throw new Error('BlockHeaderRepository not initialized.');
        }

        const trustedWitnesses = packet.trustedWitnesses;
        const validatorsWitnesses = packet.validatorWitnesses;
        const blockNumber: bigint = BigInt(packet.blockNumber.toString());

        const blockHeader: BlockHeaderBlockDocument | undefined =
            await this.blockHeaderRepository.getBlockHeader(blockNumber);

        if (!blockHeader) {
            this.fail(`Block header for block ${blockNumber.toString()} not found.`);
            return;
        }

        const blockWitness: IBlockHeaderWitness = {
            blockHash: blockHeader.hash,
            blockNumber: BigInt(blockHeader.height.toString()),
            trustedWitnesses: trustedWitnesses,
            validatorWitnesses: validatorsWitnesses,
            checksumHash: blockHeader.checksumRoot,
            previousBlockChecksum: blockHeader.previousBlockChecksum,
            previousBlockHash: blockHeader.previousBlockHash,
            merkleRoot: blockHeader.merkleRoot,
            receiptRoot: blockHeader.receiptRoot,
            storageRoot: blockHeader.storageRoot,
            txCount: blockHeader.txCount,
            checksumProofs: blockHeader.checksumProofs.map((proof) => {
                return {
                    proof: proof[1],
                };
            }),
        };

        await this.processBlockWitnesses(blockNumber, blockWitness);
    }

    public async requestBlockWitnesses(blockNumber: bigint): Promise<ISyncBlockHeaderResponse> {
        if (!this.blockWitnessRepository) {
            throw new Error('BlockWitnessRepository not initialized.');
        }

        const witnesses: [
            Promise<IParsedBlockWitnessDocument[] | undefined>,
            Promise<IParsedBlockWitnessDocument[] | undefined>,
        ] = [
            this.blockWitnessRepository.getBlockWitnesses(blockNumber),
            this.blockWitnessRepository.getBlockWitnesses(blockNumber, true),
        ];

        const [opnetWitnesses, trustedWitnesses] = await Promise.all(witnesses);
        if (!opnetWitnesses || !trustedWitnesses) {
            return {
                blockNumber: Long.fromString(blockNumber.toString()),
                trustedWitnesses: [],
                validatorWitnesses: [],
            };
        }

        const witnessesData = this.convertKnownWitnessesToOPNetWitness(opnetWitnesses);
        const trustedWitnessData = this.convertKnownWitnessesToOPNetWitness(trustedWitnesses);

        return {
            blockNumber: Long.fromString(blockNumber.toString()),
            trustedWitnesses: trustedWitnessData,
            validatorWitnesses: witnessesData,
        };
    }

    public sendMessageToThread: (
        threadType: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ) => Promise<ThreadData | null> = () => {
        throw new Error('sendMessageToThread not implemented.');
    };

    public broadcastBlockWitness: (blockWitness: IBlockHeaderWitness) => Promise<void> = () => {
        throw new Error('broadcastBlockWitness not implemented.');
    };

    public async setCurrentBlock(newBlock?: bigint): Promise<void> {
        this.currentBlock = newBlock === undefined ? await this.getCurrentBlock() : newBlock;
        OPNetConsensus.setBlockHeight(this.currentBlock);
    }

    public async generateBlockHeaderProof(
        data: BlockProcessedData,
        isSelf: boolean,
    ): Promise<void> {
        if (isSelf) {
            // if the current block is higher than the block number, this mean a reorg happened. We have to purge the known trusted witnesses.
            if (this.currentBlock >= data.blockNumber) {
                this.revertKnownWitnessesReorg(data.blockNumber);
            }

            await this.setCurrentBlock(data.blockNumber);
        }

        const blockChecksumHash = this.generateBlockHeaderChecksumHash(data);
        const signedWitness = this.identity.acknowledgeData(blockChecksumHash);
        const trustedWitness = this.identity.acknowledgeTrustedData(blockChecksumHash);

        const blockWitness: IBlockHeaderWitness = {
            ...data,
            blockNumber: Long.fromString(data.blockNumber.toString()),
            validatorWitnesses: [signedWitness],
            trustedWitnesses: [trustedWitness],
        };

        await this.processBlockWitnesses(data.blockNumber, blockWitness);
    }

    public async onBlockWitness(blockWitness: IBlockHeaderWitness): Promise<void> {
        if (this.currentBlock === -1n) {
            return;
        }

        const blockNumber: bigint = BigInt(blockWitness.blockNumber.toString());
        if (this.currentBlock === blockNumber) {
            await this.processBlockWitnesses(blockNumber, blockWitness);
        } else if (this.currentBlock < blockNumber) {
            // note: if not initialized, this.currentBlock is 0n.
            this.addToPendingWitnessesVerification(blockNumber, blockWitness);
        } else {
            await this.processBlockWitnesses(blockNumber, blockWitness);
        }

        await this.processQueuedWitnesses();
    }

    private revertKnownWitnessesReorg(toBlock: bigint): void {
        const blocks: bigint[] = Array.from(this.knownTrustedWitnesses.keys());

        for (const blockNumber of blocks) {
            if (blockNumber >= toBlock) {
                this.knownTrustedWitnesses.delete(blockNumber);
            }
        }
    }

    private purgeOldWitnesses(): void {
        const blocks = Array.from(this.knownTrustedWitnesses.keys());

        blocks.forEach((block) => {
            if (this.currentBlock - block > this.pendingBlockThreshold) {
                this.knownTrustedWitnesses.delete(block);
            }
        });
    }

    private async processQueuedWitnesses(): Promise<void> {
        if (this.currentBlock === -1n) {
            return;
        }

        const block: bigint = this.currentBlock;
        const queued = this.pendingWitnessesVerification.get(block);
        if (!queued) {
            return;
        }

        this.pendingWitnessesVerification.delete(block);

        const promises = queued.map((witness) => {
            return this.processBlockWitnesses(block, witness);
        });

        await Promise.all(promises);
    }

    private async getBlockDataAtHeight(
        blockNumber: bigint,
        blockHeader: IBlockHeaderWitness,
    ): Promise<ValidatedBlockHeader | undefined> {
        const message: ValidateBlockHeaders = {
            rpcMethod: BitcoinRPCThreadMessageType.VALIDATE_BLOCK_HEADERS,
            data: {
                blockNumber: blockNumber,
                blockHeader: blockHeader,
            },
        };

        return (await this.requestRPCData(message)) as ValidatedBlockHeader | undefined;
    }

    private removeKnownTrustedWitnesses(
        blockNumber: bigint,
        blockWitness: IBlockHeaderWitness,
    ): IBlockHeaderWitness {
        const trusted = this.knownTrustedWitnesses.get(blockNumber);
        if (!trusted) return blockWitness;

        const trustedWitnesses = blockWitness.trustedWitnesses.filter((w) => {
            return !trusted.includes(w.identity || '');
        });

        const opnetWitnesses = blockWitness.validatorWitnesses.filter((w) => {
            return !trusted.includes(w.identity || '');
        });

        return {
            ...blockWitness,
            validatorWitnesses: opnetWitnesses,
            trustedWitnesses: trustedWitnesses,
        };
    }

    private async processBlockWitnesses(
        blockNumber: bigint,
        blockWitness: IBlockHeaderWitness,
    ): Promise<void> {
        if (blockNumber < this.currentBlock - this.pendingBlockThreshold) {
            return; // we do not process old witnesses.
        }

        const filteredBlockWitnesses = this.removeKnownTrustedWitnesses(blockNumber, blockWitness);
        if (filteredBlockWitnesses.validatorWitnesses.length === 0) {
            return;
        }

        const blockDataAtHeight = await this.getBlockDataAtHeight(
            blockNumber,
            filteredBlockWitnesses,
        );

        if (!blockDataAtHeight) {
            if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                this.fail(`Failed to get block data at height ${blockNumber.toString()}`);
            }
            return;
        }

        const receivedBlockHeader = blockDataAtHeight.storedBlockHeader;
        if (!receivedBlockHeader) {
            if (this.config.DEBUG_LEVEL >= DebugLevel.ERROR) {
                this.fail(
                    `Failed to get block header data at height ${blockNumber.toString()}. (DATA INTEGRITY ERROR)`,
                );
            }
            return;
        }

        const checksumHash = receivedBlockHeader.checksumRoot;
        if (checksumHash !== blockWitness.checksumHash) {
            if (this.config.DEBUG_LEVEL >= DebugLevel.ERROR) {
                this.fail(
                    'BAD BLOCK HEADER RECEIVED. OPNet calculated checksum hash does not match the stored checksum hash. Is this node corrupted? (DATA INTEGRITY ERROR)',
                );
            }
            return;
        }

        const validProofs = blockDataAtHeight.hasValidProofs;
        if (validProofs === null) {
            if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                this.fail(`Validator can not verify the accuracy of the block yet.`);
            }
            return;
        }

        if (!validProofs) {
            if (this.config.DEBUG_LEVEL >= DebugLevel.WARN) {
                this.fail(
                    `BAD BLOCK HEADERS for block ${blockNumber.toString()}. Invalid checksum proofs!`,
                );
            }
            return;
        }

        const validWitnesses = this.validateBlockHeaderSignatures(blockWitness);
        if (!validWitnesses) {
            if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                this.fail(
                    `Received an INVALID block witness(es) for block ${blockWitness.blockNumber.toString()}`,
                );
            }
            return;
        }

        const opnetWitnesses: OPNetBlockWitness[] = validWitnesses.opnetWitnesses;
        const trustedWitnesses: OPNetBlockWitness[] = validWitnesses.validTrustedWitnesses;

        if (opnetWitnesses.length + trustedWitnesses.length < 1) {
            if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                this.fail(
                    `Received an INVALID block witness(es) for block ${blockWitness.blockNumber.toString()}`,
                );
            }
            return;
        }

        if (this.config.DEV.DISPLAY_VALID_BLOCK_WITNESS) {
            this.success(
                `BLOCK (${blockNumber}) VALIDATION SUCCESSFUL. Received ${opnetWitnesses.length} validation witness(es) and ${trustedWitnesses.length} trusted witness(es). Data integrity is maintained.`,
            );
        }

        this.addKnownTrustedWitnesses(blockNumber, opnetWitnesses);
        await this.broadcastTrustedWitnesses(blockNumber, trustedWitnesses, blockWitness);

        /** We can store the witnesses in the database after validating their data */
        await this.writeBlockWitnessesToDatabase(blockNumber, opnetWitnesses, trustedWitnesses);
    }

    private async broadcastTrustedWitnesses(
        blockNumber: bigint,
        trustedWitnesses: OPNetBlockWitness[],
        witnessData: IBlockHeaderWitness,
    ): Promise<void> {
        if (!this.blockWitnessRepository) {
            throw new Error('BlockWitnessRepository not initialized.');
        }

        const trustedWitnessIdentities = trustedWitnesses
            .map((w) => w.identity)
            .filter((i) => !!i) as string[];

        const rawWitnesses =
            (await this.blockWitnessRepository.getBlockWitnesses(
                blockNumber,
                true,
                trustedWitnessIdentities,
            )) || [];

        const newTrustedWitnesses = trustedWitnesses.filter((w) => {
            /**
             * We should not broadcast the generated witness by this trusted node twice. This would leak our identity.
             */
            return (
                w.identity !== this.identity.trustedOPNetIdentity &&
                !rawWitnesses.find((witness) => witness.identity === w.identity)
            );
        });

        if (newTrustedWitnesses.length > 0) {
            const knownWitnesses: OPNetBlockWitness[] = this.convertKnownWitnessesToOPNetWitness(
                rawWitnesses || [],
            );

            const trustedWitness: OPNetBlockWitness[] = this.mergeAndDedupeTrustedWitnesses(
                newTrustedWitnesses,
                knownWitnesses,
            );

            this.addKnownTrustedWitnesses(blockNumber, trustedWitness);

            if (this.config.DEBUG_LEVEL >= DebugLevel.TRACE) {
                this.log(
                    `Broadcasting block witness for block ${blockNumber.toString()} to OPNet network.`,
                );
            }

            const blockChecksumHash: Buffer = this.generateBlockHeaderChecksumHash(witnessData);
            const selfSignedWitness = this.identity.acknowledgeData(blockChecksumHash);

            /**
             * We spoof the validatorWitnesses to include the self-signed witness. This way, the identity of the trusted validators is not revealed.
             */
            await this.broadcastBlockWitness({
                ...witnessData,
                trustedWitnesses: trustedWitness,
                validatorWitnesses: [selfSignedWitness],
            });
        }
    }

    private addKnownTrustedWitnesses(blockNumber: bigint, witnesses: OPNetBlockWitness[]): void {
        const knownWitnesses = this.knownTrustedWitnesses.get(blockNumber);
        const trustedWitnessIdentity: string[] = witnesses.map((w) => w.identity) as string[];

        if (knownWitnesses) {
            knownWitnesses.push(...trustedWitnessIdentity);
        } else {
            this.knownTrustedWitnesses.set(blockNumber, trustedWitnessIdentity);
        }
    }

    private mergeAndDedupeTrustedWitnesses(
        newTrustedWitnesses: OPNetBlockWitness[],
        knownWitnesses: OPNetBlockWitness[],
    ): OPNetBlockWitness[] {
        const newWitnesses = newTrustedWitnesses.filter((w) => {
            return !knownWitnesses.find((kw) => kw.identity === w.identity);
        });

        return [...newWitnesses, ...knownWitnesses];
    }

    private convertKnownWitnessesToOPNetWitness(
        witnesses: IParsedBlockWitnessDocument[],
    ): OPNetBlockWitness[] {
        return witnesses.map((w) => {
            return {
                identity: w.identity,
                signature: Buffer.from(w.signature.buffer),
                opnetPubKey: w.opnetPubKey ? Buffer.from(w.opnetPubKey.buffer) : undefined,
            };
        });
    }

    private async writeBlockWitnessesToDatabase(
        blockNumber: bigint,
        opnetWitnesses: OPNetBlockWitness[],
        trustedWitnesses: OPNetBlockWitness[],
    ): Promise<void> {
        if (!this.blockWitnessRepository)
            throw new Error('BlockWitnessRepository not initialized.');

        const finalWitnesses: OPNetBlockWitness[] = [...opnetWitnesses, ...trustedWitnesses];

        // Save OPNet witnesses
        await this.blockWitnessRepository.setBlockWitnesses(blockNumber, finalWitnesses);
    }

    private async requestRPCData(
        data: RPCMessageData<BitcoinRPCThreadMessageType>,
    ): Promise<ThreadData | undefined> {
        const message: ThreadMessageBase<MessageType> = {
            type: MessageType.RPC_METHOD,
            data: data,
        };

        const response = await this.sendMessageToThread(ThreadTypes.RPC, message);
        if (!response) {
            throw new Error('Failed to get block data at height.');
        }

        return response;
    }

    private validateBlockHeaderSignatures(
        blockWitness: IBlockHeaderWitness,
    ): ValidWitnesses | undefined {
        const blockChecksumHash: Buffer = this.generateBlockHeaderChecksumHash(blockWitness);
        const validatorWitnesses: OPNetBlockWitness[] = blockWitness.validatorWitnesses;
        const trustedWitnesses: OPNetBlockWitness[] = blockWitness.trustedWitnesses;

        if (
            (validatorWitnesses.length <= 0 && trustedWitnesses.length <= 0) ||
            !blockChecksumHash
        ) {
            return;
        }

        const validTrustedWitnesses: OPNetBlockWitness[] = this.getValidTrustedWitnesses(
            blockChecksumHash,
            trustedWitnesses,
        );

        const validOPNetWitnesses: OPNetBlockWitness[] = this.validateOPNetWitnesses(
            blockChecksumHash,
            validatorWitnesses,
        );

        return {
            validTrustedWitnesses: validTrustedWitnesses,
            opnetWitnesses: validOPNetWitnesses,
        };
    }

    private getValidTrustedWitnesses(
        blockChecksumHash: Buffer,
        witnesses: OPNetBlockWitness[],
    ): OPNetBlockWitness[] {
        if (witnesses.length === 0) return [];
        if (witnesses.length > this.MAXIMUM_WITNESSES_PER_MESSAGE) {
            // reduce the number of trusted witnesses to MAXIMUM_WITNESSES_PER_MESSAGE.

            witnesses = witnesses.slice(0, this.MAXIMUM_WITNESSES_PER_MESSAGE);
        }

        return witnesses.filter((witness) => {
            return this.identity.verifyTrustedAcknowledgment(
                blockChecksumHash,
                witness,
                witness.identity,
            );
        });
    }

    private validateOPNetWitnesses(
        blockChecksumHash: Buffer,
        witnesses: OPNetBlockWitness[],
    ): OPNetBlockWitness[] {
        if (witnesses.length === 0) return [];
        if (witnesses.length > this.MAXIMUM_WITNESSES_PER_MESSAGE) {
            // reduce the number of witnesses to MAXIMUM_WITNESSES_PER_MESSAGE.
            witnesses = witnesses.slice(0, this.MAXIMUM_WITNESSES_PER_MESSAGE);
        }

        return witnesses.filter((witness) => {
            return this.identity.verifyAcknowledgment(blockChecksumHash, witness);
        });
    }

    private abs(a: bigint): bigint {
        return a < 0n ? -a : a;
    }

    private addToPendingWitnessesVerification(
        blockNumber: bigint,
        blockWitness: IBlockHeaderWitness,
    ): void {
        // We do not store any pending witnesses until we have a current block.
        if (this.currentBlock === -1n) return;

        /**
         * We reject any witnesses that are too far ahead of the current block.
         */
        if (this.abs(this.currentBlock - blockNumber) > this.pendingBlockThreshold) {
            if (this.config.DEBUG_LEVEL >= DebugLevel.TRACE) {
                this.fail(
                    `Block ${blockNumber} is too far behind the current block ${this.currentBlock}. Rejecting witness.`,
                );
            }
            return;
        }

        /** We reject any witnesses that are too far behind of the current block */
        if (blockNumber < this.currentBlock) {
            if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
                this.fail(
                    `Block ${blockNumber} is way ahead of the current block ${this.currentBlock}.`,
                );
            }
            return;
        }

        const witnesses = this.pendingWitnessesVerification.get(blockNumber);
        if (!witnesses) {
            this.pendingWitnessesVerification.set(blockNumber, [blockWitness]);
        } else if (witnesses.length < this.maxPendingWitnesses) {
            witnesses.push(blockWitness);
        }
    }

    private async getCurrentBlock(): Promise<bigint> {
        const msg: BlockProcessedMessage = {
            type: MessageType.CURRENT_INDEXER_BLOCK,
            data: {},
        };

        try {
            const resp = (await this.sendMessageToThread(
                ThreadTypes.INDEXER,
                msg,
            )) as CurrentIndexerBlockResponseData | null;

            if (!resp) {
                return -1n;
            }

            return resp.blockNumber;
        } catch (e) {
            this.info('Failed to get current block number. Retrying in 5 seconds.');
            await this.sleep(5000);

            return await this.getCurrentBlock();
        }
    }

    private sleep(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private generateBlockHeaderChecksumHash(
        data: BlockProcessedData | IBlockHeaderWitness,
    ): Buffer {
        const generatedChecksum = Buffer.concat([
            Buffer.from(data.blockHash, 'hex'),
            Buffer.from(data.previousBlockHash || '', 'hex'),
            Buffer.from(data.checksumHash.replace('0x', ''), 'hex'),
            Buffer.from(data.previousBlockChecksum.replace('0x', ''), 'hex'),
        ]);

        return this.identity.hash(generatedChecksum);
    }
}
