import { EncryptemClient } from '../../encryptem/EncryptemClient.js';
import { EncryptemServer } from '../../encryptem/EncryptemServer.js';
import { OPNetPacket } from '../../protobuf/types/OPNetPacket.js';
import { OPNetProtocolV1 } from '../../server/protocol/OPNetProtocolV1.js';
import { PeerNetworkingManager } from '../PeerNetworkingManager.js';

export abstract class SharedAuthenticationManager extends PeerNetworkingManager {
    public static readonly CURRENT_PROTOCOL_VERSION: string = '1.0.0';
    protected encryptionStarted: boolean = false;

    protected abstract _encryptem: EncryptemServer | EncryptemClient | undefined;

    protected constructor() {
        super();
    }

    protected _protocol?: OPNetProtocolV1 = new OPNetProtocolV1();

    protected get protocol(): OPNetProtocolV1 {
        if (!this._protocol) {
            throw new Error(`Protocol not found.`);
        }

        return this._protocol;
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
            const error = err as Error;

            this.error(`Peer networking error while sending message: ${error.stack}`);
        }
    }

    protected abstract onPacket(packet: OPNetPacket): Promise<boolean>;

    protected destroy(): void {
        if (this._encryptem) {
            this._encryptem.destroy();

            delete this._encryptem;
        }

        if (this.protocol) {
            this.protocol.destroy();

            delete this._protocol;
        }

        this.log(`Finishing cleaning up peer...`);
    }
}
