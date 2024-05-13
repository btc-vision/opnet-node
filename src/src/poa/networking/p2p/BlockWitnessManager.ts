import { DebugLevel, Logger } from '@btc-vision/bsi-common';
import Long from 'long';
import { BtcIndexerConfig } from '../../../config/BtcIndexerConfig.js';
import { BlockProcessedData } from '../../../threading/interfaces/thread-messages/messages/indexer/BlockProcessed.js';
import { OPNetIdentity } from '../../identity/OPNetIdentity.js';
import {
    IBlockHeaderWitness,
    OPNetBlockWitness,
} from '../protobuf/packets/blockchain/BlockHeaderWitness.js';

interface ValidWitnesses {
    validTrustedWitnesses: OPNetBlockWitness[];
    opnetWitnesses: OPNetBlockWitness[];
}

export class BlockWitnessManager extends Logger {
    public readonly logColor: string = '#00ffe1';

    constructor(
        private readonly config: BtcIndexerConfig,
        private readonly identity: OPNetIdentity,
    ) {
        super();
    }

    public broadcastBlockWitness: (blockWitness: IBlockHeaderWitness) => Promise<void> =
        async () => {
            throw new Error('broadcastBlockWitness not implemented.');
        };

    public async generateBlockHeaderProof(data: BlockProcessedData): Promise<void> {
        const blockChecksumHash = this.generateBlockHeaderChecksumHash(data);
        const signedWitness = this.identity.acknowledgeData(blockChecksumHash);
        const trustedWitness = this.identity.acknowledgeTrustedData(blockChecksumHash);

        const blockWitness: IBlockHeaderWitness = {
            ...data,
            blockNumber: Long.fromString(data.blockNumber.toString()),
            validatorWitnesses: [signedWitness],
            trustedWitnesses: [trustedWitness],
        };

        await this.broadcastBlockWitness(blockWitness);
    }

    public async onBlockWitness(blockWitness: IBlockHeaderWitness): Promise<void> {
        const validWitnesses = this.validateBlockHeaderSignatures(blockWitness);
        if (!validWitnesses) {
            if (this.config.DEBUG_LEVEL >= DebugLevel.INFO) {
                this.fail(
                    `Received an INVALID block witness(es) for block ${blockWitness.blockNumber.toString()}`,
                );
            }
            return;
        }

        if (this.config.DEBUG_LEVEL >= DebugLevel.WARN) {
            this.success(
                `Received a VALID block witness(es) for block ${blockWitness.blockNumber.toString()}`,
            );
        }

        console.log('Valid trusted witnesses:', validWitnesses.validTrustedWitnesses);
        console.log('Valid OPNet witnesses:', validWitnesses.opnetWitnesses);
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
