import { Config } from '../../config/Config.js';
import { BitcoinZeroMQTopic } from './enums/BitcoinZeroMQTopic.js';
import { ZeroMQ } from './ZeroMQ.js';

export class NewBlockSubscription extends ZeroMQ<BitcoinZeroMQTopic.EVERYTHING> {
    constructor() {
        const topic = BitcoinZeroMQTopic.EVERYTHING;
        const zeroMQConfig = Config.ZERO_MQ[topic];

        if (!zeroMQConfig) {
            throw new Error('ZeroMQ config not found');
        }

        super(zeroMQConfig.ADDRESS, zeroMQConfig.PORT, topic);
    }

    protected async onEvent(topic: string, message: Buffer): Promise<void> {
        console.log('New notification received', topic, message);
    }
}
