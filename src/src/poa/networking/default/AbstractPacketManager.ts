import { Logger } from '@btc-vision/bsi-common';
import { CommonHandlers } from '../../events/CommonHandlers.js';
import { OPNetIdentity } from '../../identity/OPNetIdentity.js';
import { NetworkingEventHandler } from '../interfaces/IEventHandler.js';
import { OPNetPacket } from '../protobuf/types/OPNetPacket.js';
import { OPNetProtocolV1 } from '../server/protocol/OPNetProtocolV1.js';

export abstract class AbstractPacketManager extends Logger {
    private eventHandlers: Map<string, NetworkingEventHandler<object>[]> = new Map();

    protected constructor(
        protected readonly protocol: OPNetProtocolV1,
        protected readonly peerId: string,
        protected readonly selfIdentity: OPNetIdentity | undefined,
    ) {
        super();
    }

    public destroy(): void {
        this.eventHandlers.clear();
    }

    public abstract onPacket(packet: OPNetPacket): Promise<boolean>;

    public on<T extends string, U extends object>(
        event: T,
        eventHandler: NetworkingEventHandler<U>,
    ): void {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }

        this.eventHandlers.get(event)?.push(eventHandler as NetworkingEventHandler<object>);
    }

    protected async sendMsg(data: Uint8Array | Buffer): Promise<void> {
        await this.emit(CommonHandlers.SEND, data);
    }

    protected async emit<T extends string, U extends object>(event: T, data: U): Promise<void> {
        if (!this.eventHandlers.has(event)) return;

        const promises: Promise<void>[] = [];
        for (const handler of this.eventHandlers.get(event)!) {
            promises.push(handler(data));
        }

        await Promise.all(promises);
    }
}
