import { Logger } from '@btc-vision/bsi-common';
import { BtcIndexerConfig } from '../../config/BtcIndexerConfig.js';

export class P2PManager extends Logger {
    public readonly logColor: string = '#00ffe1';

    constructor(private readonly config: BtcIndexerConfig) {
        super();
    }
}
