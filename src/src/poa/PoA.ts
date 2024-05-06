import { Logger } from '@btc-vision/bsi-common';
import figlet from 'figlet';
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

        setTimeout(() => {
            this.notifyArt('OPNet');
        }, 7000);
    }

    private notifyArt(text: string): void {
        const artVal = figlet.textSync(text, {
            font: 'Doh', //'Whimsy',
            horizontalLayout: 'default',
            verticalLayout: 'default',
        });

        //this.important(``);

        this.info(
            `\n\n\n\n\n\nPoA enabled. Successfully connected to,\n\n\n\n\n\n${artVal}\nYour node is now authenticated and has joined the network. Welcome!\n\n\n`,
        );
    }
}
