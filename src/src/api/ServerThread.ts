import { Globals } from '@btc-vision/bsi-common';
import { Config } from '../config/Config.js';
import { DBManagerInstance } from '../db/DBManager.js';
import { MessageType } from '../threading/enum/MessageType.js';
import { ThreadMessageBase } from '../threading/interfaces/thread-messages/ThreadMessageBase.js';
import { ThreadTypes } from '../threading/thread/enums/ThreadTypes.js';
import { Thread } from '../threading/thread/Thread.js';

import { Server } from './Server.js';
import { ThreadData } from '../threading/interfaces/ThreadData.js';

Globals.register();

class ServerThreadBase extends Thread<ThreadTypes.API> {
    public readonly threadType: ThreadTypes.API = ThreadTypes.API;

    public logColor: string = '#7fffd4';

    private readonly server: Server = new Server();

    constructor() {
        super();

        void this.init();
    }

    protected onMessage(_m: ThreadMessageBase<MessageType>): Promise<void> {
        throw new Error('Method not implemented.');
    }

    protected async init() {
        this.log(`Starting API on port ${Config.API.PORT}.`);

        DBManagerInstance.setup();
        await DBManagerInstance.connect();

        await this.server.init(Config.API.PORT);
    }

    protected onLinkMessage(
        _type: ThreadTypes,
        _msg: ThreadMessageBase<MessageType>,
    ): Promise<ThreadData> {
        throw new Error('Method not implemented.');
    }
}

export const ServerThread = new ServerThreadBase();
