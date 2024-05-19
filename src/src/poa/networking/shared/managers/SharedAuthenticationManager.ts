import { P2PVersion, TRUSTED_CHECKSUM } from '../../../configurations/P2PVersion.js';
import { OPNetIdentity } from '../../../identity/OPNetIdentity.js';
import { AbstractPacketManager } from '../../default/AbstractPacketManager.js';
import { EncryptemClient } from '../../encryptem/EncryptemClient.js';
import { EncryptemServer } from '../../encryptem/EncryptemServer.js';
import { NetworkingEventHandler } from '../../interfaces/IEventHandler.js';
import { OPNetPacket } from '../../protobuf/types/OPNetPacket.js';
import { OPNetProtocolV1 } from '../../server/protocol/OPNetProtocolV1.js';
import { PeerNetworkingManager } from '../PeerNetworkingManager.js';

export abstract class SharedAuthenticationManager extends PeerNetworkingManager {
    public static readonly CURRENT_PROTOCOL_VERSION: string = '1.0.0';

    protected encryptionStarted: boolean = false;
    protected destroyed: boolean = false;

    protected networkHandlers: AbstractPacketManager[] = [];
    protected isAuthenticated: boolean = false;

    protected abstract _encryptem: EncryptemServer | EncryptemClient | undefined;

    private eventHandlers: Map<string, NetworkingEventHandler<object>[]> = new Map();

    protected constructor(protected selfIdentity: OPNetIdentity | undefined) {
        super();
    }

    protected _protocol?: OPNetProtocolV1 = new OPNetProtocolV1();

    protected get protocol(): OPNetProtocolV1 {
        if (!this._protocol) {
            throw new Error(`Protocol not found.`);
        }

        return this._protocol;
    }

    public trustedChecksum(): string {
        const checksum = TRUSTED_CHECKSUM[P2PVersion];
        if (!checksum) {
            throw new Error('Trusted checksum not found.');
        }

        return checksum;
    }

    public on<T extends string, U extends object>(
        event: T,
        eventHandler: NetworkingEventHandler<U>,
    ): void {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }

        this.eventHandlers.get(event)?.push(eventHandler as NetworkingEventHandler<object>);
    }

    public decrypt(_raw: Uint8Array): Uint8Array {
        let raw: Uint8Array | null = _raw;
        if (this.encryptionStarted && this._encryptem) {
            raw = this._encryptem.decrypt(raw);
        }

        if (!raw) {
            console.log(_raw);
            throw new Error(`Unable to decrypt incoming message.`);
        }

        return raw;
    }

    /**
     * On message handler.
     * @public
     */
    public async onMessage(rawBuf: Uint8Array): Promise<boolean> {
        if (this.destroyed) return false;

        const raw: Uint8Array = this.decrypt(rawBuf);

        const opcode: number = raw[0];
        const packet: OPNetPacket = {
            opcode: opcode,
            packet: Buffer.from(raw.slice(1)),
        };

        const managed: boolean = await this.onPacket(packet);
        if (!managed && this.isAuthenticated) {
            for (const handler of this.networkHandlers) {
                const processed: boolean = await handler.onPacket(packet);

                if (processed) {
                    return true;
                }
            }
        }
        return managed;
    }

    protected async emit<T extends string, U extends object>(event: T, data: U): Promise<void> {
        if (!this.eventHandlers.has(event)) return;

        const promises: Promise<void>[] = [];
        for (const handler of this.eventHandlers.get(event)!) {
            promises.push(handler(data));
        }

        await Promise.all(promises);
    }

    protected async sendMsg(buffer: Buffer | Uint8Array): Promise<void> {
        if (!this._encryptem) throw new Error('Encryptem not found.');

        try {
            if (this.encryptionStarted && this._encryptem) {
                const encryptedBuf = this._encryptem.encrypt(buffer);
                if (!encryptedBuf) {
                    throw new Error('Unable to encrypt message.');
                }

                buffer = encryptedBuf;
            }

            await this.send(buffer);
        } catch (err: unknown) {
            /*
                const error = err as Error;
                this.error(`Peer networking error while sending message: ${error.message}`);
             */
        }
    }

    protected abstract onPacket(packet: OPNetPacket): Promise<boolean>;

    protected onAuthenticated(): void {
        this.isAuthenticated = true;

        this.createSession();
    }

    protected abstract createSession(): void;

    protected destroy(): void {
        if (this._encryptem) {
            this._encryptem.destroy();

            delete this._encryptem;
        }

        if (this.protocol) {
            this.protocol.destroy();

            delete this._protocol;
        }

        this.eventHandlers.clear();

        this.destroyNetworkHandlers();
    }

    private destroyNetworkHandlers(): void {
        for (const handler of this.networkHandlers) {
            handler.destroy();
        }

        this.networkHandlers = [];
    }
}
