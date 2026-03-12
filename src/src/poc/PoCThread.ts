import { Config } from '../config/Config.js';
import { MessageType } from '../threading/enum/MessageType.js';
import { ThreadMessageBase } from '../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../threading/interfaces/ThreadData.js';
import { ThreadTypes } from '../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../threading/thread/Thread.js';
import { PoC } from './PoC.js';
import { IBlockHeaderWitness } from './networking/protobuf/packets/blockchain/common/BlockHeaderWitness.js';
import { reconstructBlockWitness } from './witness/WitnessSerializer.js';

export class PoCThread extends Thread<ThreadTypes.P2P> {
    public readonly threadType: ThreadTypes.P2P = ThreadTypes.P2P;

    private poc: PoC = new PoC(Config);

    constructor() {
        super();

        this.init();
    }

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {}

    protected init(): void {
        this.poc.sendMessageToThread = this.sendMessageToThread.bind(this);
        this.poc.sendMessageToAllThreads = this.sendMessageToAllThreads.bind(this);

        /**
         * Make sure that other threads are setup before starting PoC.
         */
        setTimeout(() => {
            void this.onThreadLinkSetup();
        }, 5000);
    }

    protected async onLinkMessage(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<undefined | ThreadData> {
        switch (type) {
            case ThreadTypes.INDEXER: {
                return await this.handleBitcoinIndexerMessage(m);
            }
            case ThreadTypes.API: {
                return await this.handleBitcoinIndexerMessage(m);
            }
            case ThreadTypes.MEMPOOL: {
                return await this.handleBitcoinIndexerMessage(m);
            }
            case ThreadTypes.SSH: {
                return await this.handleBitcoinIndexerMessage(m);
            }
            case ThreadTypes.WITNESS: {
                return await this.handleWitnessMessage(m);
            }
            default: {
                throw new Error(`Unknown message sent by thread of type: ${type}`);
            }
        }
    }

    protected async onThreadLinkSetup(): Promise<void> {
        await this.poc.init();
    }

    private async handleBitcoinIndexerMessage(
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData> {
        return await this.poc.handleBitcoinIndexerMessage(m);
    }

    private async handleWitnessMessage(
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | undefined> {
        switch (m.type) {
            case MessageType.WITNESS_BROADCAST: {
                // Witness thread wants us to broadcast a witness to peers.
                // Long instances lose their prototype after structured clone
                // (worker_threads postMessage); reconstruct before use.
                const witness = reconstructBlockWitness(m.data as IBlockHeaderWitness);
                await this.poc.broadcastBlockWitness(witness);
                return {};
            }
            case MessageType.WITNESS_REQUEST_PEERS: {
                // Witness thread wants us to request witnesses from peers
                const data = m.data as { blockNumber: bigint };
                await this.poc.requestPeerWitnesses(data.blockNumber);
                return {};
            }
            default:
                return undefined;
        }
    }
}

new PoCThread();
