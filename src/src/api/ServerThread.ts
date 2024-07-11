import { Globals } from '@btc-vision/bsi-common';
import { Config } from '../config/Config.js';
import { DBManagerInstance } from '../db/DBManager.js';
import { MessageType } from '../threading/enum/MessageType.js';
import { ThreadMessageBase } from '../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadTypes } from '../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../threading/thread/Thread.js';

import { Server } from './Server.js';

Globals.register();

class ServerThreadBase extends Thread<ThreadTypes.API> {
    public readonly threadType: ThreadTypes.API = ThreadTypes.API;

    public logColor: string = '#7fffd4';

    private readonly server: Server = new Server();

    constructor() {
        super();

        void this.init();
    }

    protected async onMessage(m: ThreadMessageBase<MessageType>): Promise<void> {
        switch (m.type) {
            default:
                this.error(`Unknown thread message received. {Type: ${m.type}}`);
                break;
        }
    }

    protected async init() {
        this.log(`Starting API on port ${Config.API.PORT}.`);

        await DBManagerInstance.setup(Config.DATABASE.CONNECTION_TYPE);
        await DBManagerInstance.connect();

        await this.server.init(Config.API.PORT);
    }

    protected async onLinkMessage(
        type: ThreadTypes,
        msg: ThreadMessageBase<MessageType>,
    ): Promise<void> {
        console.log('onLinkMessage', type, msg);
    }
}

export const ServerThread = new ServerThreadBase();
