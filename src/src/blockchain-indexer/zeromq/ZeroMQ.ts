import { Logger } from '@btc-vision/motoswapcommon';
import zmq from 'zeromq';
import { MessageType } from '../../threading/enum/MessageType.js';
import { RPCMessage } from '../../threading/interfaces/thread-messages/messages/api/RPCMessage.js';
import { ThreadMessageBase } from '../../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadData } from '../../threading/interfaces/ThreadData.js';
import { ThreadTypes } from '../../threading/thread/enums/ThreadTypes.js';
import { BitcoinRPCThreadMessageType } from '../rpc/thread/messages/BitcoinRPCThreadMessage.js';
import { BitcoinZeroMQTopic } from './enums/BitcoinZeroMQTopic.js';

export abstract class ZeroMQ<T extends BitcoinZeroMQTopic> extends Logger {
    public readonly logColor: string = '#afeeee';

    protected socket: zmq.Subscriber = new zmq.Subscriber();

    protected constructor(
        private readonly address: string,
        private readonly port: string,
        private readonly topic: T,
    ) {
        super();

        this.createConnection();
    }

    protected async requestRPCMethod<T extends BitcoinRPCThreadMessageType>(
        m: RPCMessage<T>,
    ): Promise<ThreadData | null> {
        return await this.sendMessageToThread(ThreadTypes.BITCOIN_RPC, m);
    }

    public async sendMessageToThread(
        _threadType: ThreadTypes,
        _m: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData | null> {
        throw new Error('Method not implemented.');
    }

    protected abstract onEvent(topic: BitcoinZeroMQTopic, message: Buffer): Promise<void>;

    private async listenForMessage(): Promise<void> {
        this.warn(`ZeroMQ connection established`);

        for await (const [topic, msg] of this.socket) {
            const topicString = topic.toString();

            void this.onEvent(topicString as BitcoinZeroMQTopic, msg);
        }

        this.warn(`ZeroMQ connection closed`);
    }

    private createConnection(): void {
        this.socket.connect(`tcp://${this.address}:${this.port}`);

        const topic = this.topic === BitcoinZeroMQTopic.EVERYTHING ? '' : this.topic;
        this.socket.subscribe(topic.toLowerCase());

        void this.listenForMessage();
    }
}
