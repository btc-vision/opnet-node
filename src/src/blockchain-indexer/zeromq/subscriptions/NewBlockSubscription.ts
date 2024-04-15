import { Config } from '../../../config/Config.js';
import { BitcoinZeroMQTopic } from '../enums/BitcoinZeroMQTopic.js';
import { ZeroMQ } from '../ZeroMQ.js';

export class NewBlockSubscription extends ZeroMQ<BitcoinZeroMQTopic.RAWBLOCK> {
    constructor() {
        const topic = BitcoinZeroMQTopic.RAWBLOCK;
        const zeroMQConfig = Config.ZERO_MQ[topic] || Config.ZERO_MQ[BitcoinZeroMQTopic.EVERYTHING];

        if (!zeroMQConfig) {
            throw new Error(`ZeroMQ config not found for ${topic}`);
        }

        super(zeroMQConfig.ADDRESS, zeroMQConfig.PORT, topic);
    }

    protected async onEvent(topic: string, message: Buffer): Promise<void> {
        console.log('New block notification received', topic, message);
    }
}
