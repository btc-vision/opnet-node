import Long from 'long';
import { clearInterval } from 'node:timers';
import { OPNetIdentity } from '../../../identity/OPNetIdentity.js';
import { EncryptemClient } from '../../encryptem/EncryptemClient.js';
import { IClientKeyCipherExchangePacket } from '../../protobuf/packets/authentication/exchange/ClientKeyCipherExchange.js';
import {
    IServerKeyCipherExchangePacket,
    ServerKeyCipherExchange,
} from '../../protobuf/packets/authentication/exchange/ServerKeyCipherExchange.js';
import { IAuthenticationPacket } from '../../protobuf/packets/authentication/OPNetAuthentication.js';
import {
    AuthenticationStatus,
    IAuthenticationStatusPacket,
} from '../../protobuf/packets/authentication/status/AuthentificationStatus.js';
import { IPingPacket } from '../../protobuf/packets/latency/Ping.js';
import { IPongPacket, Pong } from '../../protobuf/packets/latency/Pong.js';
import { OPNetAuthenticationStatus } from '../../protobuf/types/enums/OPNetAuthentificationStatus.js';
import { Packets } from '../../protobuf/types/enums/Packets.js';
import { CommonPackets, ServerOutBound } from '../../protobuf/types/messages/OPNetMessages.js';
import { OPNetPacket } from '../../protobuf/types/OPNetPacket.js';
import { AuthenticationManager } from '../../server/managers/AuthenticationManager.js';
import { SharedAuthenticationManager } from '../../shared/managers/SharedAuthenticationManager.js';
import { ConnectionStatus } from '../enums/ConnectionStatus.js';

export abstract class ClientAuthenticationManager extends SharedAuthenticationManager {
    public readonly logColor: string = '#08fa00';

    protected _encryptem: EncryptemClient = new EncryptemClient();
    protected selfIdentity: OPNetIdentity | undefined;

    private pingInterval: NodeJS.Timeout | null = null;

    private lastServerPing: Long = Long.fromInt(Date.now());
    private lastPing: Long = Long.fromInt(Date.now());
    private latency: number = 0;

    #OPNetAuthKey: Uint8Array | null = null;
    #OPNetClientKeyCipher: Uint8Array | null = null;
    #connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;

    protected constructor(selfIdentity: OPNetIdentity | undefined) {
        super();

        this.selfIdentity = selfIdentity;
    }

    public get connectionStatus(): ConnectionStatus {
        return this.#connectionStatus;
    }

    protected set connectionStatus(status: ConnectionStatus) {
        this.#connectionStatus = status;

        this.log(`Connection status changed to ${status}.`);
    }

    protected get encryptemClient(): EncryptemClient {
        if (!this._encryptem) {
            throw new Error(`Encryptem not defined.`);
        }

        return this._encryptem;
    }

    public async logout(): Promise<void> {
        this.#OPNetAuthKey = null;
        this.#OPNetClientKeyCipher = null;

        await this.disconnectPeer(3000, 'Goodbye.');
    }

    protected async onPacket(packet: OPNetPacket): Promise<boolean> {
        const opcode: number = packet.opcode;

        switch (opcode) {
            case ServerOutBound.AUTHENTICATION_STATUS: {
                await this.handleAuthenticationStatusPacket(packet);
                break;
            }

            case ServerOutBound.SERVER_CIPHER_EXCHANGE: {
                await this.handleServerCipherExchangePacket(packet);
                break;
            }

            case CommonPackets.PONG: {
                await this.handlePongPacket(packet);
                break;
            }

            default:
                return false;
        }

        return true;
    }

    protected async buildKeyCipherExchangeClientPacket(): Promise<void> {
        if (!this.selfIdentity) {
            throw new Error('Self identity not found.');
        }

        if (!(this.#OPNetAuthKey && this.#OPNetClientKeyCipher)) {
            throw new Error(' Authorization Key not selected.');
        }

        const keyCipherExchangePacket = this.protocol.getPacketBuilder(
            Packets.ClientKeyCipherExchange,
        );

        if (!keyCipherExchangePacket) {
            return;
        }

        const keyCipherExchangeData: IClientKeyCipherExchangePacket = {
            clientKeyCipher: this.#OPNetClientKeyCipher,
            clientAuthCipher: this.#OPNetAuthKey,
            identity: this.selfIdentity.opnetAddressAsBuffer,
        };

        const packedKeyCipherExchangeData = keyCipherExchangePacket.pack(keyCipherExchangeData);
        await this.sendMsg(packedKeyCipherExchangeData);
    }

    protected async sendPing(): Promise<void> {
        const pingPacket = this.protocol.getPacketBuilder(Packets.Ping);
        if (!pingPacket) {
            return;
        }

        this.lastPing = Long.fromInt(Date.now());

        const pingData: IPingPacket = {
            timestamp: this.lastPing,
            lastPing: this.lastServerPing,
        };

        const packedPingData = pingPacket.pack(pingData);
        await this.sendMsg(packedPingData);
    }

    protected stopPingInterval(): void {
        if (this.pingInterval) clearInterval(this.pingInterval);
    }

    protected async attemptAuth(key: Uint8Array): Promise<void> {
        this.log('Attempting to authenticate with OPNet Server...');

        this.connectionStatus = ConnectionStatus.AUTHENTICATING;

        const authPacket = this.protocol.getPacketBuilder(Packets.Authentication);
        if (!authPacket) {
            return;
        }

        await this.setupKey(key);

        if (!this.#OPNetAuthKey) {
            throw new Error('Authorization key not selected.');
        }

        const authData: IAuthenticationPacket = {
            version: AuthenticationManager.CURRENT_PROTOCOL_VERSION,
            clientAuthCipher: this.#OPNetAuthKey,
        };

        let packedAuthData = authPacket.pack(authData);
        await this.sendMsg(packedAuthData);
    }

    protected destroy(): void {
        super.destroy();

        if (this.pingInterval) clearInterval(this.pingInterval);
    }

    private async setupKey(uint8Key: Uint8Array): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const isOk = await this.setupEncryptem(uint8Key);
            if (!isOk) {
                reject(new Error('Failed to setup client encryptem.'));
            }

            this.success('Successfully selected OPNet key.');

            try {
                const publicKeyResponse = this.getClientPublicKey();

                if (publicKeyResponse.publicKey && publicKeyResponse.authKey) {
                    this.#OPNetClientKeyCipher = publicKeyResponse.publicKey;
                    this.#OPNetAuthKey = publicKeyResponse.authKey;

                    resolve();
                } else {
                    this.error('Failed to get  public key.');

                    reject(new Error('Failed to get  public key.'));
                }
            } catch (e) {
                console.log(e);
                reject(e);
            }
        });
    }

    private getClientPublicKey(): {
        publicKey: Uint8Array | null;
        authKey: Uint8Array | null;
    } {
        const publicKey = this.encryptemClient.getClientPublicKey();
        const authKey = this.encryptemClient.getClientSignaturePublicKey();

        if (!publicKey || !authKey) {
            throw new Error('Failed to get encryptem client public key.');
        }

        return {
            publicKey: new Uint8Array(
                Buffer.from(publicKey.buffer, publicKey.byteOffset, publicKey.byteLength),
            ),
            authKey: new Uint8Array(
                Buffer.from(authKey.buffer, authKey.byteOffset, authKey.byteLength),
            ),
        };
    }

    private async setupEncryptem(authKey: Uint8Array): Promise<boolean> {
        this.encryptemClient.destroy();

        return await this.encryptemClient.generateClientCipherKeyPair(authKey);
    }

    private async handlePongPacket(packet: OPNetPacket): Promise<void> {
        const serverPong = (await this.protocol.onIncomingPacket<IPongPacket>(packet)) as Pong;
        if (!serverPong) {
            return;
        }

        this.latency = Long.fromInt(Date.now()).subtract(this.lastPing).toNumber();
        this.info(`Latency: ${this.latency}ms.`);
    }

    private startPingInterval(): void {
        this.stopPingInterval();

        this.pingInterval = setInterval(async () => {
            await this.sendPing();
        }, 10000);

        void this.sendPing();
    }

    private async handleServerCipherExchangePacket(packet: OPNetPacket): Promise<void> {
        const serverCipherPacket =
            (await this.protocol.onIncomingPacket<IServerKeyCipherExchangePacket>(
                packet,
            )) as ServerKeyCipherExchange;

        if (!serverCipherPacket) {
            return;
        }

        const unpackedServerCipherData = serverCipherPacket.unpack(packet.packet);
        if (!unpackedServerCipherData) {
            return;
        }

        if (
            !(
                unpackedServerCipherData.encryptionEnabled &&
                unpackedServerCipherData.serverKeyCipher &&
                unpackedServerCipherData.serverSigningCipher
            )
        ) {
            throw new Error(`Invalid server cipher data.`);
        }

        await this.setCipherKeys(
            unpackedServerCipherData.serverKeyCipher,
            unpackedServerCipherData.serverSigningCipher,
        );

        this.encryptionStarted = true;

        this.startPingInterval();
    }

    private async setCipherKeys(
        serverKeyCipher: Uint8Array,
        serverSigningCipher: Uint8Array,
    ): Promise<void> {
        this.encryptemClient.setServerPublicKey(Buffer.from(serverKeyCipher));
        this.encryptemClient.setServerSignaturePublicKey(Buffer.from(serverSigningCipher));

        this.encryptemClient.startEncryption();
    }

    private async handleAuthenticationStatusPacket(packet: OPNetPacket): Promise<void> {
        const authPacket = (await this.protocol.onIncomingPacket<IAuthenticationStatusPacket>(
            packet,
        )) as AuthenticationStatus;

        if (!authPacket) {
            return;
        }

        const unpackedAuthData = authPacket.unpack(packet.packet);
        if (!unpackedAuthData) {
            return;
        }

        if (unpackedAuthData.status === OPNetAuthenticationStatus.SUCCESS) {
            await this.buildKeyCipherExchangeClientPacket();
            this.success('Successfully authenticated with the remote peer.');

            this.connectionStatus = ConnectionStatus.AUTHENTICATION_SUCCESS;
        } else {
            this.fail(`Failed to authenticate with the remote peer: ${unpackedAuthData.message}`);

            this.connectionStatus = ConnectionStatus.AUTHENTICATION_FAILED;
        }
    }
}
