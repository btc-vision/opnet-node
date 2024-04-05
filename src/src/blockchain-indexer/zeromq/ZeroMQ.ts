import { Logger } from '@btc-vision/motoswapcommon';
import zmq from 'zeromq';
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
