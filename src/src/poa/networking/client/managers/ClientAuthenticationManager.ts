import Long from 'long';
import { clearInterval } from 'node:timers';
import { OPNetIdentity } from '../../../identity/OPNetIdentity.js';
import { EncryptemClient } from '../../encryptem/EncryptemClient.js';
import { DisconnectionCode } from '../../enums/DisconnectionCode.js';
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
import { Config } from '../../../../config/Config.js';
import { DebugLevel } from '@btc-vision/bsi-common';
import { NetworkConverter } from '../../../../config/network/NetworkConverter.js';

export abstract class ClientAuthenticationManager extends SharedAuthenticationManager {
    public readonly logColor: string = '#08fa00';

    protected readonly peerId: string;

    protected _encryptem: EncryptemClient = new EncryptemClient();

    private pingInterval: NodeJS.Timeout | null = null;

    private lastServerPing: Long = Long.fromInt(Date.now());
    private lastPing: Long = Long.fromInt(Date.now());
    private latency: number = 0;

    #OPNetAuthKey: Uint8Array | null = null;
    #OPNetClientKeyCipher: Uint8Array | null = null;
    #connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;

    protected constructor(selfIdentity: OPNetIdentity | undefined, peerId: string) {
        super(selfIdentity);

        this.peerId = peerId;
    }

    public get connectionStatus(): ConnectionStatus {
        return this.#connectionStatus;
    }

    protected set connectionStatus(status: ConnectionStatus) {
        this.#connectionStatus = status;
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

        await this.disconnectPeer(DisconnectionCode.EXPECTED, 'Goodbye.');
    }

    protected async onPacket(packet: OPNetPacket): Promise<boolean> {
        const opcode: ServerOutBound | CommonPackets = packet.opcode as
            | ServerOutBound
            | CommonPackets;

        switch (opcode) {
            case ServerOutBound.AUTHENTICATION_STATUS: {
                await this.handleAuthenticationStatusPacket(packet);
                break;
            }

            case ServerOutBound.SERVER_CIPHER_EXCHANGE: {
                this.handleServerCipherExchangePacket(packet);
                break;
            }

            case CommonPackets.PONG: {
                this.handlePongPacket(packet);
                break;
            }

            default:
                return false;
        }

        return true;
    }

    protected async buildKeyCipherExchangeClientPacket(challenge: Uint8Array): Promise<void> {
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

        const challengeResponse: Buffer = this.selfIdentity.identityChallenge(challenge);
        const keyCipherExchangeData: IClientKeyCipherExchangePacket = {
            clientKeyCipher: this.#OPNetClientKeyCipher,
            clientAuthCipher: this.#OPNetAuthKey,
            identity: this.selfIdentity.opnetAddressAsBuffer,
            challenge: challengeResponse,
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
        if (!this.selfIdentity) throw new Error('(attemptAuth) Self identity not found.');

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
            trustedChecksum: this.trustedChecksum(),
            type: this.selfIdentity.peerType,
            network: this.selfIdentity.peerNetwork,
            chainId: this.selfIdentity.peerChainId,
        };

        if (NetworkConverter.hasMagicNumber) {
            authData.magicNumber = NetworkConverter.magicNumber;
        }

        await this.sendMsg(authPacket.pack(authData));
    }

    protected destroy(): void {
        super.destroy();

        if (this.pingInterval) clearInterval(this.pingInterval);
    }

    protected override onAuthenticated(): void {
        if (!this.protocol) {
            throw new Error(`Protocol not found.`);
        }

        this.protocol.onAuthenticated();
        this.startPingInterval();

        super.onAuthenticated();
    }

    private async setupKey(uint8Key: Uint8Array): Promise<void> {
        return new Promise((resolve, reject) => {
            const isOk = this.setupEncryptem(uint8Key);
            if (!isOk) {
                reject(new Error('Failed to setup client encryptem.'));
            }

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
                reject(e as Error);
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

    private setupEncryptem(authKey: Uint8Array): boolean {
        this.encryptemClient.destroy();

        return this.encryptemClient.generateClientCipherKeyPair(authKey);
    }

    private handlePongPacket(packet: OPNetPacket): void {
        const serverPong = this.protocol.onIncomingPacket<IPongPacket>(packet) as Pong;
        if (!serverPong) {
            return;
        }

        this.latency = Long.fromInt(Date.now()).subtract(this.lastPing).toNumber();

        if (Config.DEBUG_LEVEL >= DebugLevel.TRACE) {
            this.info(`Latency with ${this.peerId}: ${this.latency}ms.`);
        }
    }

    private startPingInterval(): void {
        this.stopPingInterval();

        this.pingInterval = setInterval(async () => {
            await this.sendPing();
        }, 10000);

        void this.sendPing();
    }

    private handleServerCipherExchangePacket(packet: OPNetPacket): void {
        const serverCipherPacket = this.protocol.onIncomingPacket<IServerKeyCipherExchangePacket>(
            packet,
        ) as ServerKeyCipherExchange;

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

        this.setCipherKeys(
            unpackedServerCipherData.serverKeyCipher,
            unpackedServerCipherData.serverSigningCipher,
        );

        this.encryptionStarted = true;
        this.onAuthenticated();
    }

    private setCipherKeys(serverKeyCipher: Uint8Array, serverSigningCipher: Uint8Array): void {
        this.encryptemClient.setServerPublicKey(Buffer.from(serverKeyCipher));
        this.encryptemClient.setServerSignaturePublicKey(Buffer.from(serverSigningCipher));
    }

    private async handleAuthenticationStatusPacket(packet: OPNetPacket): Promise<void> {
        const authPacket = this.protocol.onIncomingPacket<IAuthenticationStatusPacket>(
            packet,
        ) as AuthenticationStatus;

        if (!authPacket) {
            return;
        }

        const unpackedAuthData = authPacket.unpack(packet.packet);
        if (!unpackedAuthData) {
            return;
        }

        if (
            unpackedAuthData.status === OPNetAuthenticationStatus.SUCCESS &&
            unpackedAuthData.challenge
        ) {
            await this.buildKeyCipherExchangeClientPacket(unpackedAuthData.challenge);
            this.success(`Successfully authenticated with ${this.peerId}.`);

            this.connectionStatus = ConnectionStatus.AUTHENTICATION_SUCCESS;
        } else {
            this.fail(`Failed to authenticate with ${this.peerId}: ${unpackedAuthData.message}`);

            this.connectionStatus = ConnectionStatus.AUTHENTICATION_FAILED;
        }
    }
}
