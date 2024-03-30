import { Config } from '../config/Config.js';
import { DBManagerInstance } from '../db/DBManager.js';
import { MessageType } from '../threading/enum/MessageType.js';
import { ThreadMessageBase } from '../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { Thread } from '../threading/thread/Thread.js';
import { Globals } from '../utils/Globals.js';

import { Server } from './Server.js';

Globals.register();

export class ServerThread extends Thread {
    public logColor: string = '#7fffd4';

    private server: Server = new Server();

    constructor() {
        super();

        void this.initApi();
    }

    private async initApi() {
        this.log(`Starting API on port ${Config.API.PORT}.`);

        await DBManagerInstance.setup();
        await DBManagerInstance.connect();

        await this.server.init(Config.API.PORT);
    }

    protected async onMessage(m: ThreadMessageBase<MessageType>): Promise<void> {
        let data = m.data;

        switch (m.type) {
            default:
                console.log(m);
                this.error(`Unknown thread message received. {Type: ${m.type}}`);
                break;
        }
    }
}

new ServerThread();
