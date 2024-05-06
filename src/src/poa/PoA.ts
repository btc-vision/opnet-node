import { Logger } from '@btc-vision/bsi-common';

export class PoA extends Logger {
    public readonly logColor: string = '#00ffe1';

    constructor() {
        super();
    }

    public async init(): Promise<void> {
        this.log(`Starting PoA...`);
    }
}
