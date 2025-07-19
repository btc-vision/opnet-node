import { Logger } from '@btc-vision/logger';
import { VMStorage } from '../../../vm/storage/VMStorage.js';
import { IndexingTask } from '../tasks/IndexingTask.js';
import { OPNetConsensus } from '../../../poa/configurations/OPNetConsensus.js';
import { SHA1 } from '../../../utils/SHA1.js';
import { IEpochDocument } from '../../../db/documents/interfaces/IEpochDocument.js';
import { DataConverter } from '@btc-vision/bsi-db';
import { Binary } from 'mongodb';
import { sha256 } from '@btc-vision/bitcoin';
import { EpochDifficultyConverter } from '../../../poa/epoch/EpochDifficultyConverter.js';
import { EpochValidator } from '../../../poa/epoch/EpochValidator.js';

export interface IEpoch {
    startBlock: bigint;
    targetHash: Buffer;
    target: Buffer;
    solution: Buffer;
    salt: Buffer;
    publicKey: Buffer;
    graffiti?: Buffer;
    solutionBits: number;
}

interface EpochUpdateResult {
    readonly update: boolean;
    readonly currentEpoch: bigint;
}

export class EpochManager extends Logger {
    public readonly logColor: string = '#009dff';

    private readonly epochValidator: EpochValidator;

    public constructor(private readonly storage: VMStorage) {
        super();

        this.epochValidator = new EpochValidator(this.storage);
    }

    public async updateEpoch(task: IndexingTask): Promise<void> {
        await Promise.resolve();

        if (task.tip === 0n) {
            return await this.finalizeEmptyEpoch(task, 0n);
        }

        const shouldUpdate = this.shouldUpdateEpoch(task.tip);
        if (!shouldUpdate.update) {
            return;
        }

        await this.finalizeEpoch(task, shouldUpdate.currentEpoch);
    }

    private createEpoch(epoch: IEpoch): IEpochDocument {
        return {
            epochNumber: DataConverter.toDecimal128(
                epoch.startBlock / BigInt(OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH),
            ),
            epochHash: new Binary(this.hashEpoch(epoch)),
            targetHash: new Binary(epoch.targetHash),
            startBlock: DataConverter.toDecimal128(epoch.startBlock),
            endBlock: DataConverter.toDecimal128(
                epoch.startBlock + BigInt(OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH),
            ),
            difficultyScaled: EpochDifficultyConverter.bitsToScaledDifficulty(
                epoch.solutionBits,
            ).toString(),
            proposer: {
                solution: new Binary(epoch.solution),
                publicKey: new Binary(epoch.publicKey),
                salt: new Binary(epoch.salt),
                graffiti: epoch.graffiti ? new Binary(epoch.graffiti) : undefined,
            },
        };
    }

    private hashEpoch(epoch: IEpoch): Buffer {
        const heightBuffer = Buffer.alloc(8);
        heightBuffer.writeBigUint64BE(epoch.startBlock);

        return sha256(
            Buffer.concat([
                heightBuffer,
                epoch.target,
                epoch.targetHash,
                epoch.salt,
                epoch.publicKey,
                epoch.graffiti || Buffer.alloc(16),
            ]),
        );
    }

    private async finalizeEpoch(task: IndexingTask, epochNumber: bigint): Promise<void> {
        // Load all the previous epoch data..

        const submissions = await this.storage.getSubmissionsByEpochNumber(epochNumber - 1n);
        if (!submissions || submissions.length === 0) {
            return await this.finalizeEmptyEpoch(task, epochNumber);
        }

        throw new Error('Epoch finalization not implemented yet.'); // TODO: Implement epoch finalization logic
    }

    private async finalizeEmptyEpoch(task: IndexingTask, epochNumber: bigint): Promise<void> {
        const preimage = Buffer.from(task.block.checksumRoot.replace('0x', ''), 'hex');

        const targetHash = Buffer.from(SHA1.hash(preimage), 'hex');
        const publicKey = OPNetConsensus.consensus.EPOCH.GENESIS_PROPOSER_PUBLIC_KEY;
        const salt = Buffer.alloc(32);

        const solution = this.epochValidator.calculatePreimage(targetHash, publicKey, salt);

        const solutionHash = Buffer.from(SHA1.hash(solution), 'hex');
        const matchingBits = this.epochValidator.countMatchingBits(solutionHash, targetHash);

        const epoch: IEpoch = {
            startBlock: epochNumber * BigInt(OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH),
            targetHash: targetHash,
            target: preimage,
            solution: solutionHash,
            salt: salt,
            publicKey: publicKey.toBuffer(),
            graffiti: Buffer.alloc(0),
            solutionBits: matchingBits,
        };

        const epochDocument = this.createEpoch(epoch);
        await this.storage.saveEpoch(epochDocument);

        this.log(
            `!! -- Finalized epoch ${epochNumber} [${epochDocument.proposer.solution.toString('hex')} (Diff: ${EpochDifficultyConverter.formatDifficulty(BigInt(epochDocument.difficultyScaled))})] (${epochDocument.epochHash.toString('hex')}) -- !!`,
        );
    }

    private shouldUpdateEpoch(tip: bigint): EpochUpdateResult {
        const currentEpoch = tip / OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH;
        const lastBlockEpoch = (tip - 1n) / OPNetConsensus.consensus.EPOCH.BLOCKS_PER_EPOCH;

        return {
            update: currentEpoch > lastBlockEpoch,
            currentEpoch: currentEpoch,
        };
    }
}
