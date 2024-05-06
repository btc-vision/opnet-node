import { Logger } from '@btc-vision/bsi-common';
import { BtcIndexerConfig } from '../config/BtcIndexerConfig.js';
import { P2PManager } from './networking/P2PManager.js';

export class PoA extends Logger {
    public readonly logColor: string = '#00ffe1';

    private readonly p2p: P2PManager;

    constructor(private readonly config: BtcIndexerConfig) {
        super();

        this.p2p = new P2PManager(this.config);
    }

    public async init(): Promise<void> {
        this.log(`Starting PoA...`);
    }
}
