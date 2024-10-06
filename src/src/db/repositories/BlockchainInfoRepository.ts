import { BaseRepository } from '@btc-vision/bsi-common';
import {
    ChangeStream,
    ChangeStreamDocument,
    ChangeStreamUpdateDocument,
    Collection,
    Db,
    Filter,
} from 'mongodb';
import { IBlockchainInformationDocument } from '../documents/interfaces/IBlockchainInformationDocument.js';

import { BitcoinNetwork } from '../../config/network/BitcoinNetwork.js';

type BlockChangeStreamDocument = ChangeStreamDocument<{ inProgressBlock: number }>;

type BlockChangeStream =
    | ChangeStream<{ inProgressBlock: number }, BlockChangeStreamDocument>
    | undefined;

export class BlockchainInfoRepository extends BaseRepository<IBlockchainInformationDocument> {
    public readonly logColor: string = '#afeeee';

    private readonly blockUpdateListeners: Array<(blockHeight: bigint) => void> = [];
    private changeStream: BlockChangeStream;

    public constructor(db: Db) {
        super(db);
    }

    public async getByNetwork(network: string): Promise<IBlockchainInformationDocument> {
        const criteria: Partial<Filter<IBlockchainInformationDocument>> = {
            network: network,
        };

        const result: IBlockchainInformationDocument | null = await this.queryOne(criteria);
        if (result === null) {
            return this.createDefault(network);
        }

        return result;
    }

    public async updateCurrentBlockInProgress(
        network: string,
        blockInProgress: number,
    ): Promise<void> {
        const criteria: Partial<Filter<IBlockchainInformationDocument>> = {
            network: network,
        };

        const document: Partial<IBlockchainInformationDocument> = {
            inProgressBlock: blockInProgress,
        };

        await this.updatePartial(criteria, document);
    }

    public watchBlockChanges(cb: (blockHeight: bigint) => void): void {
        this.blockUpdateListeners.push(cb);

        this.createWatcher();
    }

    public createWatcher(): void {
        if (this.changeStream) {
            return;
        }

        const collection = this.getCollection();
        this.changeStream = collection.watch<{ inProgressBlock: number }>();

        this.createChangeStreamListeners();
    }

    public async getCurrentBlockAndTriggerListeners(network: BitcoinNetwork): Promise<void> {
        const currentBlockInfo = await this.getByNetwork(network);

        let currentBlockNumber = currentBlockInfo.inProgressBlock;
        if (currentBlockNumber < 0) {
            currentBlockNumber = 0;
        }

        this.triggerBlockUpdateListeners(BigInt(currentBlockNumber));
    }

    protected override getCollection(): Collection<IBlockchainInformationDocument> {
        return this._db.collection('BlockchainInformation');
    }

    private triggerBlockUpdateListeners(blockHeight: bigint): void {
        this.blockUpdateListeners.forEach((listener) => {
            listener(blockHeight);
        });
    }

    private createChangeStreamListeners(): void {
        if (!this.changeStream) {
            return;
        }

        this.changeStream.on(
            'change',
            (change: ChangeStreamUpdateDocument<IBlockchainInformationDocument>) => {
                console.log('Change stream update:', change);
                
                const updatedFields = change.updateDescription?.updatedFields;

                if (!updatedFields) {
                    return;
                }

                const updatedProgressBlock = updatedFields.inProgressBlock;
                if (updatedProgressBlock === undefined) {
                    return;
                }

                // We are getting the next block, so we need to subtract 1 to get the current block.
                let blockHeight = BigInt(updatedProgressBlock);
                if (blockHeight < 0n) {
                    blockHeight = 0n;
                }

                this.triggerBlockUpdateListeners(blockHeight);
            },
        );
    }

    private createDefault(network: string): IBlockchainInformationDocument {
        return {
            network: network,
            inProgressBlock: 0,
        };
    }
}
