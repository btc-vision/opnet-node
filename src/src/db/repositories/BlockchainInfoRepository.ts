import { BaseRepository } from '@btc-vision/bsi-common';
import {
    ChangeStream,
    ChangeStreamDocument,
    ChangeStreamOptions,
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

interface UpdatedChangeStreamDocument
    extends ChangeStreamUpdateDocument<IBlockchainInformationDocument> {
    readonly wallTime?: Date;
}

export class BlockchainInfoRepository extends BaseRepository<IBlockchainInformationDocument> {
    public readonly logColor: string = '#afeeee';

    private readonly blockUpdateListeners: Array<(blockHeight: bigint) => void> = [];
    private changeStream: BlockChangeStream;

    private lastPolledBlockHeight: bigint = -1n;
    private pollingInterval: NodeJS.Timeout | null = null;

    private readonly POLLING_INTERVAL_MS = 1000;

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

        //this.createWatcher();
        this.startPolling();
    }

    public createWatcher(): void {
        if (this.changeStream) {
            return;
        }

        const collection = this.getCollection();

        // Configure change stream for lower latency
        const options: ChangeStreamOptions = {
            fullDocument: 'updateLookup', // Get the full document on updates
            batchSize: 1, // Process changes immediately
        };

        this.changeStream = collection.watch<{ inProgressBlock: number }>(
            [
                {
                    $match: {
                        'updateDescription.updatedFields.inProgressBlock': { $exists: true },
                    },
                },
            ],
            options,
        );

        this.createChangeStreamListeners();
    }

    public async getCurrentBlockAndTriggerListeners(network: BitcoinNetwork): Promise<void> {
        const currentBlockInfo = await this.getByNetwork(network);

        let currentBlockNumber = currentBlockInfo.inProgressBlock;
        if (currentBlockNumber < 0) {
            currentBlockNumber = 0;
        }

        const blockHeight = BigInt(currentBlockNumber);
        this.lastPolledBlockHeight = blockHeight;
        this.triggerBlockUpdateListeners(blockHeight);
    }

    /*public async destroy(): Promise<void> {
        if (this.changeStream) {
            await this.changeStream.close();
            this.changeStream = undefined;
        }

        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }*/

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

        this.changeStream.on('change', (change: UpdatedChangeStreamDocument) => {
            // Handle both update and replace operations
            let updatedProgressBlock: number | undefined;

            if (change.operationType === 'update') {
                updatedProgressBlock = change.updateDescription?.updatedFields?.inProgressBlock;
            } else if (change.operationType === 'replace' && change.fullDocument) {
                const fullDoc = change.fullDocument as { inProgressBlock: number };
                updatedProgressBlock = fullDoc.inProgressBlock;
            }

            if (updatedProgressBlock === undefined) {
                return;
            }

            let blockHeight = BigInt(updatedProgressBlock);
            if (blockHeight < 0n) {
                blockHeight = 0n;
            }

            this.triggerBlockUpdateListeners(blockHeight);
        });

        this.changeStream.on('error', (error) => {
            this.error(`Change stream error: ${error.message}`);
            
            // Attempt to recreate the change stream
            this.changeStream = undefined;
            setTimeout(() => this.createWatcher(), 1000);
        });
    }

    private startPolling(): void {
        if (this.pollingInterval) {
            return;
        }

        // Poll the database periodically
        this.pollingInterval = setInterval(async () => {
            try {
                // Get the latest block info for all networks
                const info = await this.getCollection().findOne({});
                if (!info) {
                    this.error('No blockchain information found in the database.');
                    return;
                }

                const blockHeight = BigInt(info.inProgressBlock || 0);

                // Only trigger if the block height changed
                if (blockHeight !== this.lastPolledBlockHeight) {
                    this.lastPolledBlockHeight = blockHeight;

                    this.triggerBlockUpdateListeners(blockHeight);
                }
            } catch (error) {
                this.error(`Polling error: ${(error as Error).message}`);
            }
        }, this.POLLING_INTERVAL_MS);
    }

    private createDefault(network: string): IBlockchainInformationDocument {
        return {
            network: network,
            inProgressBlock: 0,
        };
    }
}
