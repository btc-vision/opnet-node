import { MessageType } from '../../threading/enum/MessageType.js';
import { ThreadMessageBase } from '../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../../threading/interfaces/ThreadData.js';
import { ThreadTypes } from '../../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../../threading/thread/Thread.js';
import { RPCMessage } from '../../threading/interfaces/thread-messages/messages/api/RPCMessage.js';
import { BitcoinRPCThreadMessageType } from '../../blockchain-indexer/rpc/thread/messages/BitcoinRPCThreadMessage.js';
import {
    BroadcastOPNetRequest,
    OPNetBroadcastData,
    OPNetBroadcastResponse,
} from '../../threading/interfaces/thread-messages/messages/api/BroadcastTransactionOPNet.js';
import { btrace } from '../../utils/BroadcastTrace.js';

/**
 * Dedicated thread that fronts OPNet transaction broadcasting. The API used to
 * send BROADCAST_TRANSACTION_OPNET straight to the P2P thread, which is the
 * same thread that handles BLOCK_PROCESSED / witness dispatch. When that thread
 * is busy (mempool churn) or wedged, the API's broadcast sat on its 240s
 * timeout.
 *
 * This thread isolates the API-facing acceptance: it forwards the publish to
 * P2P over its own dedicated channel (so it no longer contends with the
 * indexer/witness traffic on P2P's inbound port) and, crucially, bounds the
 * wait so the API gets an answer in seconds rather than the 240s thread
 * timeout. The libp2p node still lives on P2P, so the actual network fan-out
 * is performed there; only the wait is decoupled.
 */
export class BroadcastThread extends Thread<ThreadTypes.BROADCAST> {
    public readonly threadType: ThreadTypes.BROADCAST = ThreadTypes.BROADCAST;

    /**
     * Hard cap on how long the API waits for P2P to acknowledge the queueing of
     * a broadcast. P2PManager.broadcastTransaction is a synchronous enqueue, so
     * in the healthy case this completes in well under a millisecond; the cap
     * only matters when P2P's event loop is momentarily saturated. On timeout
     * the message has still been delivered to P2P's port and will be processed;
     * we simply stop blocking the API on it.
     */
    private readonly FORWARD_TIMEOUT_MS: number = 15_000;

    constructor() {
        super();
        this.init();
    }

    protected init(): void {}

    protected async onMessage(_message: ThreadMessageBase<MessageType>): Promise<void> {}

    protected async onLinkMessage(
        type: ThreadTypes,
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | undefined> {
        switch (type) {
            case ThreadTypes.API: {
                return await this.handleAPIMessage(m);
            }
            default: {
                this.warn(`BroadcastThread: unexpected message from thread type: ${type}`);
                return undefined;
            }
        }
    }

    private async handleAPIMessage(
        m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | undefined> {
        if (m.type !== MessageType.RPC_METHOD) {
            this.warn(`BroadcastThread: unexpected message type from API: ${m.type}`);
            return {};
        }

        const rpc = m as RPCMessage<BitcoinRPCThreadMessageType>;
        switch (rpc.data.rpcMethod) {
            case BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET: {
                return await this.forwardBroadcast(rpc.data.data as OPNetBroadcastData);
            }
            default: {
                this.warn(`BroadcastThread: unknown RPC method from API: ${rpc.data.rpcMethod}`);
                return {};
            }
        }
    }

    private async forwardBroadcast(data: OPNetBroadcastData): Promise<OPNetBroadcastResponse> {
        btrace('BroadcastThread.forwardBroadcast', `ENTER id=${data.id} -> forwarding to P2P (bounded ${this.FORWARD_TIMEOUT_MS}ms)`);

        // A fresh message with NO taskId. Forwarding the received message object
        // would re-use its taskId, and Thread.sendMessage short-circuits any
        // message that already carries one (resolving null immediately instead
        // of awaiting P2P's reply).
        const forwardMsg: RPCMessage<BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET> = {
            type: MessageType.RPC_METHOD,
            data: {
                rpcMethod: BitcoinRPCThreadMessageType.BROADCAST_TRANSACTION_OPNET,
                data: {
                    raw: data.raw,
                    psbt: data.psbt,
                    id: data.id,
                },
            } as BroadcastOPNetRequest,
        };

        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const forwarded: Promise<ThreadData | null> = this.sendMessageToThread(
                ThreadTypes.P2P,
                forwardMsg,
            );

            const timedOut: Promise<null> = new Promise((resolve) => {
                timer = setTimeout(() => resolve(null), this.FORWARD_TIMEOUT_MS);
            });

            const result = await Promise.race([forwarded, timedOut]);

            if (result && typeof result === 'object' && 'peers' in result) {
                const peers = (result as { peers: number }).peers;
                btrace('BroadcastThread.forwardBroadcast', `DONE id=${data.id} peers=${peers}`);
                return { peers };
            }

            btrace('BroadcastThread.forwardBroadcast', `TIMEOUT/empty id=${data.id} (P2P slow or wedged); returning peers=0`);
            return { peers: 0 };
        } catch (e) {
            // sendMessageToThread throws "Thread relation not found" if the P2P
            // link is not up yet (the ~6s startup window) or the pool is empty.
            // Never let that propagate as an unanswered broadcast.
            const details = e instanceof Error ? e.message : String(e);
            btrace('BroadcastThread.forwardBroadcast', `ERROR id=${data.id}: ${details}; returning peers=0`);
            return { peers: 0 };
        } finally {
            if (timer !== undefined) {
                clearTimeout(timer);
            }
        }
    }
}

new BroadcastThread();
