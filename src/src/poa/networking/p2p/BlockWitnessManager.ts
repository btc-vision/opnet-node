import Long from 'long';
import { BlockProcessedData } from '../../../threading/interfaces/thread-messages/messages/indexer/BlockProcessed.js';
import { OPNetIdentity } from '../../identity/OPNetIdentity.js';
import { IBlockHeaderWitness } from '../protobuf/packets/blockchain/BlockHeaderWitness.js';

export class BlockWitnessManager {
    constructor(private readonly identity: OPNetIdentity) {}

    public broadcastBlockWitness: (blockWitness: IBlockHeaderWitness) => Promise<void> =
        async () => {
            throw new Error('broadcastBlockWitness not implemented.');
        };

    public async generateBlockHeaderProof(data: BlockProcessedData): Promise<void> {
        const blockChecksumHash = this.generateBlockHeaderChecksumHash(data);
        const signedWitness = this.identity.aknowledgeData(blockChecksumHash);
        const trustedWitness = this.identity.aknowledgeTrustedData(blockChecksumHash);

        const blockWitness: IBlockHeaderWitness = {
            ...data,
            blockNumber: Long.fromString(data.blockNumber.toString()),
            validatorWitnesses: [signedWitness],
            trustedWitnesses: [trustedWitness],
        };

        await this.broadcastBlockWitness(blockWitness);
    }

    public async onBlockWitness(blockWitness: IBlockHeaderWitness): Promise<void> {
        console.log(`[MUST VERIFY] Block witness ->`, blockWitness);
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
