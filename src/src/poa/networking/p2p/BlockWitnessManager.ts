import { DebugLevel, Logger } from '@btc-vision/bsi-common';
import Long from 'long';
import { BitcoinRPCThreadMessageType } from '../../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { BtcIndexerConfig } from '../../../config/BtcIndexerConfig.js';
import { MessageType } from '../../../threading/enum/MessageType.js';
import { RPCMessageData } from '../../../threading/interfaces/thread-messages/messages/api/RPCMessage.js';
import {
    ValidateBlockHeaders,
    ValidatedBlockHeader,
} from '../../../threading/interfaces/thread-messages/messages/api/ValidateBlockHeaders.js';
import { BlockProcessedData } from '../../../threading/interfaces/thread-messages/messages/indexer/BlockProcessed.js';
import { ThreadMessageBase } from '../../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../../../threading/interfaces/ThreadData.js';
import { ThreadTypes } from '../../../threading/thread/enums/ThreadTypes.js';
import { OPNetIdentity } from '../../identity/OPNetIdentity.js';
import {
    IBlockHeaderWitness,
    OPNetBlockWitness,
} from '../protobuf/packets/blockchain/BlockHeaderWitness.js';

interface ValidWitnesses {
    validTrustedWitnesses: OPNetBlockWitness[];
    opnetWitnesses: OPNetBlockWitness[];
}

/** TODO: We should move this class in it's own thread in the future for better performance */
export class BlockWitnessManager extends Logger {
    public readonly logColor: string = '#00ffe1';

    /** How many blocks we can store in memory before we start rejecting witnesses */
    private readonly pendingBlockThreshold: bigint = 10n;
    private readonly maxPendingWitnesses: number = 50;

    private pendingWitnessesVerification: Map<bigint, IBlockHeaderWitness[]> = new Map();
    private currentBlock: bigint = 0n;

    constructor(
        private readonly config: BtcIndexerConfig,
        private readonly identity: OPNetIdentity,
    ) {
        super();

        this.pendingBlockThreshold =
            BigInt(this.config.OP_NET.TRANSACTIONS_MAXIMUM_CONCURRENT) || 10n;
        console.log(this.pendingBlockThreshold);
    }

    public sendMessageToThread: (
        threadType: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ) => Promise<ThreadData | null> = async () => {
        throw new Error('sendMessageToThread not implemented.');
    };

    public broadcastBlockWitness: (blockWitness: IBlockHeaderWitness) => Promise<void> =
        async () => {
            throw new Error('broadcastBlockWitness not implemented.');
        };

    public async generateBlockHeaderProof(
        data: BlockProcessedData,
        isSelf: boolean,
    ): Promise<void> {
        if (isSelf) {
            this.currentBlock = data.blockNumber;
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

        await this.onBlockWitness(blockWitness);
        await this.broadcastBlockWitness(blockWitness);
    }

    public async onBlockWitness(blockWitness: IBlockHeaderWitness): Promise<void> {
        const blockNumber: bigint = BigInt(blockWitness.blockNumber.toString());
        if (this.currentBlock === blockNumber) {
            await this.processBlockWitnesses(blockNumber, blockWitness);
        } else if (this.currentBlock < blockNumber) {
            this.addToPendingWitnessesVerification(blockNumber, blockWitness);
        } else {
            await this.processBlockWitnesses(blockNumber, blockWitness);
        }

        await this.processQueuedWitnesses();
    }

    private async processQueuedWitnesses(): Promise<void> {
        const block = this.currentBlock;

        const queued = this.pendingWitnessesVerification.get(block);
        if (!queued) {
            return;
        }

        this.pendingWitnessesVerification.delete(block);

        const promises = queued.map((witness) => {
            return this.processBlockWitnesses(this.currentBlock, witness);
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

    private async processBlockWitnesses(
        blockNumber: bigint,
        blockWitness: IBlockHeaderWitness,
    ): Promise<void> {
        const blockDataAtHeight = await this.getBlockDataAtHeight(blockNumber, blockWitness);
        if (!blockDataAtHeight) {
            if (this.config.DEBUG_LEVEL >= DebugLevel.INFO) {
                this.fail(`Failed to get block data at height ${blockNumber.toString()}`);
            }
            return;
        }

        const validProofs = blockDataAtHeight.hasValidProofs;
        if (validProofs === null) {
            if (this.config.DEBUG_LEVEL >= DebugLevel.INFO) {
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
            if (this.config.DEBUG_LEVEL >= DebugLevel.INFO) {
                this.fail(
                    `Received an INVALID block witness(es) for block ${blockWitness.blockNumber.toString()}`,
                );
            }
            return;
        }

        if (validWitnesses.opnetWitnesses.length === 0) {
            return;
        }

        const receivedBlockHeader = blockDataAtHeight.storedBlockHeader;
        if (!receivedBlockHeader) {
            return;
        }

        const checksumHash = receivedBlockHeader.checksumRoot;
        if (checksumHash !== blockWitness.checksumHash) {
            if (this.config.DEBUG_LEVEL >= DebugLevel.ERROR) {
                this.fail(
                    'BAD BLOCK HEADER RECEIVED. OPNet calculated checksum hash does not match the stored checksum hash. (DATA INTEGRITY ERROR',
                );
            }
            return;
        }

        const opnetWitnesses: OPNetBlockWitness[] = validWitnesses.opnetWitnesses;
        const trustedWitnesses: OPNetBlockWitness[] = validWitnesses.validTrustedWitnesses;

        this.success(
            `BLOCK (${blockNumber}) VALIDATION SUCCESSFUL. Received ${opnetWitnesses.length} validation witness(es) and ${trustedWitnesses.length} trusted witness(es). Data integrity is intact.`,
        );

        /** We can store the witnesses in the database after validating their data */
    }

    private async requestRPCData(
        data: RPCMessageData<BitcoinRPCThreadMessageType>,
    ): Promise<ThreadData | void> {
        const message: ThreadMessageBase<MessageType> = {
            type: MessageType.RPC_METHOD,
            data: data,
        };

        const response = await this.sendMessageToThread(ThreadTypes.BITCOIN_RPC, message);
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

        if (validatorWitnesses.length <= 0 || trustedWitnesses.length <= 0) {
            return;
        }

        const validOPNetWitnesses: OPNetBlockWitness[] = this.validateOPNetWitnesses(
            blockChecksumHash,
            validatorWitnesses,
        );

        if (!validOPNetWitnesses) {
            return;
        }

        const validTrustedWitnesses: OPNetBlockWitness[] = this.getValidTrustedWitnesses(
            blockChecksumHash,
            trustedWitnesses,
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
        return witnesses.filter((witness) => {
            return this.identity.verifyTrustedAcknowledgment(blockChecksumHash, witness);
        });
    }

    private validateOPNetWitnesses(
        blockChecksumHash: Buffer,
        witnesses: OPNetBlockWitness[],
    ): OPNetBlockWitness[] {
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
        if (!this.currentBlock) return;

        /**
         * We reject any witnesses that are too far ahead of the current block.
         */
        if (this.abs(this.currentBlock - blockNumber) > this.pendingBlockThreshold) {
            if (this.config.DEBUG_LEVEL >= DebugLevel.DEBUG) {
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

    private generateBlockHeaderChecksumHash(
        data: BlockProcessedData | IBlockHeaderWitness,
    ): Buffer {
        const generatedChecksum = Buffer.concat([
            Buffer.from(data.blockHash, 'hex'),
            Buffer.from(data.previousBlockHash || '', 'hex'),
            Buffer.from(data.checksumHash, 'hex'),
            Buffer.from(data.previousBlockChecksum, 'hex'),
        ]);

        return this.identity.hash(generatedChecksum);
    }
}
