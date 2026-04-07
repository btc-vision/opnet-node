import { Config } from '../../config/Config.js';
import { DBManagerInstance } from '../../db/DBManager.js';
import { MessageType } from '../../threading/enum/MessageType.js';
import { ThreadMessageBase } from '../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../../threading/interfaces/ThreadData.js';
import { ThreadTypes } from '../../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../../threading/thread/Thread.js';
import { BlockWitnessManager } from '../networking/p2p/BlockWitnessManager.js';
import { OPNetIdentity } from '../identity/OPNetIdentity.js';
import { BlockProcessedData } from '../../threading/interfaces/thread-messages/messages/indexer/BlockProcessed.js';
import { IBlockHeaderWitness } from '../networking/protobuf/packets/blockchain/common/BlockHeaderWitness.js';
import { ISyncBlockHeaderResponse } from '../networking/protobuf/packets/blockchain/responses/SyncBlockHeadersResponse.js';
import { reconstructBlockWitness, reconstructSyncResponse } from './WitnessSerializer.js';

export class WitnessThread extends Thread<ThreadTypes.WITNESS> {
    public readonly threadType: ThreadTypes.WITNESS = ThreadTypes.WITNESS;

    private blockWitnessManager: BlockWitnessManager | undefined;

    /**
     * Peer witness messages that arrive before the first WITNESS_BLOCK_PROCESSED.
     *
     * The WitnessThread has no INDEXER link, so it cannot call getCurrentBlock()
     * to seed BlockWitnessManager.currentBlock on startup. Instead, the height
     * is set by the first WITNESS_BLOCK_PROCESSED from the P2P thread.
     *
     * Any peer witnesses arriving before that point would be silently dropped
     * by BlockWitnessManager (currentBlock === -1n guard). We buffer them here
     * and replay once the first block is processed so they are not lost.
     */
    private pendingPeerMessages: Array<ThreadMessageBase<MessageType>> = [];
    private currentBlockSet: boolean = false;

    constructor() {
        super();
        this.init();
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {}

    protected init(): void {
        // Delay startup to let thread links establish
        setTimeout(() => {
            void this.onThreadLinkSetup();
        }, 5000);
    }

    protected onLinkMessage(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): undefined | ThreadData {
        switch (type) {
            case ThreadTypes.P2P: {
                return this.handleP2PMessage(m);
            }
            default: {
                this.warn(`WitnessThread: unexpected message from thread type: ${type}`);
                return undefined;
            }
        }
    }

    protected async onThreadLinkSetup(): Promise<void> {
        this.log('Initializing WitnessThread...');

        // Create own DB connection
        DBManagerInstance.setup();
        await DBManagerInstance.connect();

        // Create identity (same as P2P thread does)
        const identity = new OPNetIdentity(Config);

        // Create and initialize BlockWitnessManager
        this.blockWitnessManager = new BlockWitnessManager(Config, identity);
        this.blockWitnessManager.sendMessageToThread = this.sendMessageToThread.bind(this);
        this.blockWitnessManager.broadcastBlockWitness = this.broadcastViaPeer.bind(this);

        await this.blockWitnessManager.init();

        this.success('WitnessThread initialized.');
    }

    private handleP2PMessage(m: ThreadMessageBase<MessageType>): ThreadData | undefined {
        if (!this.blockWitnessManager) {
            this.warn('WitnessThread: BlockWitnessManager not initialized yet, dropping message.');
            return {};
        }

        switch (m.type) {
            case MessageType.WITNESS_HEIGHT_UPDATE: {
                // Broadcast to ALL instances: update currentBlock so peer witnesses
                // for recent blocks are accepted (not rejected as "too old").
                const { blockNumber } = m.data as { blockNumber: bigint };
                this.blockWitnessManager.setCurrentBlock(blockNumber, true).then(
                    () => {
                        if (!this.currentBlockSet) {
                            this.currentBlockSet = true;
                            // Height is now set, replay any buffered peer witnesses
                            this.flushPendingPeerMessages();
                        }
                    },
                    () => {},
                );

                return {};
            }
            case MessageType.WITNESS_BLOCK_PROCESSED: {
                // Round-robin to ONE instance: generate proof for this block.
                // Height is already set by WITNESS_HEIGHT_UPDATE (broadcast).
                const data = m.data as BlockProcessedData;

                this.blockWitnessManager.queueSelfWitness(data, () => {
                    // After witness generated, tell P2P to request from peers
                    void this.sendMessageToThread(ThreadTypes.P2P, {
                        type: MessageType.WITNESS_REQUEST_PEERS,
                        data: { blockNumber: data.blockNumber },
                    });
                });

                return {};
            }
            case MessageType.WITNESS_PEER_DATA: {
                // Buffer if the current block height has not been set yet
                if (!this.currentBlockSet) {
                    this.pendingPeerMessages.push(m);
                    return {};
                }

                // Long instances lose their prototype after structured clone;
                // reconstruct them so downstream code can call .toBigInt() etc.
                const witnessData = reconstructBlockWitness(m.data as IBlockHeaderWitness);
                this.blockWitnessManager.onBlockWitness(witnessData);
                return {};
            }
            case MessageType.WITNESS_PEER_RESPONSE: {
                // Buffer if the current block height has not been set yet
                if (!this.currentBlockSet) {
                    this.pendingPeerMessages.push(m);
                    return {};
                }

                // Reconstruct Long values degraded by structured clone
                const packet = reconstructSyncResponse(m.data as ISyncBlockHeaderResponse);
                void this.blockWitnessManager.onBlockWitnessResponse(packet).catch((e: unknown) => {
                    this.error(`onBlockWitnessResponse error: ${(e as Error).stack}`);
                });
                return {};
            }
            default: {
                this.warn(`WitnessThread: unknown message type: ${m.type}`);
                return undefined;
            }
        }
    }

    /**
     * Replay peer witness messages that were buffered before the first
     * WITNESS_BLOCK_PROCESSED set the current block height.
     */
    private flushPendingPeerMessages(): void {
        const pending = this.pendingPeerMessages;
        this.pendingPeerMessages = [];

        if (pending.length > 0) {
            this.log(`Replaying ${pending.length} buffered peer witness message(s).`);
        }

        for (const msg of pending) {
            this.handleP2PMessage(msg);
        }
    }

    private async broadcastViaPeer(blockWitness: IBlockHeaderWitness): Promise<void> {
        // Send witness back to P2P thread for broadcasting to peers
        await this.sendMessageToThread(ThreadTypes.P2P, {
            type: MessageType.WITNESS_BROADCAST,
            data: blockWitness,
        });
    }
}

new WitnessThread();
