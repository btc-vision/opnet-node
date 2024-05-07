import { EncryptemServer } from '../../encryptem/EncryptemServer.js';
import {
    ClientKeyCipherExchange,
    IClientKeyCipherExchangePacket,
} from '../../protobuf/packets/authentication/exchange/ClientKeyCipherExchange.js';
import {
    IServerKeyCipherExchangePacket,
    ServerKeyCipherExchange,
} from '../../protobuf/packets/authentication/exchange/ServerKeyCipherExchange.js';
import {
    AuthenticationPacket,
    IAuthenticationPacket,
} from '../../protobuf/packets/authentication/OPNetAuthentication.js';
import {
    AuthenticationStatus,
    IAuthenticationStatusPacket,
} from '../../protobuf/packets/authentication/status/AuthentificationStatus.js';
import { IPingPacket } from '../../protobuf/packets/latency/Ping.js';
import { Pong } from '../../protobuf/packets/latency/Pong.js';
import { OPNetAuthenticationStatus } from '../../protobuf/types/enums/OPNetAuthentificationStatus.js';
import { Packets } from '../../protobuf/types/enums/Packets.js';
import { ServerInBound } from '../../protobuf/types/messages/OPNetMessages.js';
import { OPNetPacket } from '../../protobuf/types/OPNetPacket.js';
import { SharedAuthenticationManager } from '../../shared/managers/SharedAuthenticationManager.js';

export abstract class AuthenticationManager extends SharedAuthenticationManager {
    protected isAuthenticated: boolean = false;

    protected abstract readonly peerId: string;

    private passVersionCheck: boolean = false;
    private timeoutAuth: NodeJS.Timeout | null = null;

    private _peerIdentity: string | undefined;

    public get peerIdentity(): string {
        if (!this._peerIdentity) {
            throw new Error(`Peer identity not defined.`);
        }

        return this._peerIdentity;
    }

    protected _encryptem: EncryptemServer = new EncryptemServer();

    private get encryptem(): EncryptemServer {
        if (!this._encryptem) {
            throw new Error(`Encryptem not defined.`);
        }

        return this._encryptem;
    }

    protected createTimeoutAuth(): void {
        this.timeoutAuth = setTimeout(() => {
            void this.disconnectPeer(1007, 'Authentication timeout.');
        }, 30000);
    }

    protected onAuthenticated(): void {
        if (!this.protocol) {
            throw new Error(`Protocol not found.`);
        }

        this.info(
            `!!!! ----- Successfully authenticated peer ${this.peerId} with OPNet. Retrieving peer information... ----- !!!!`,
        );

        this.protocol.onAuthenticated();
    }

    protected async onPacket(packet: OPNetPacket): Promise<boolean> {
        const opcode: number = packet.opcode;

        switch (opcode) {
            case ServerInBound.AUTHENTICATION:
                await this.onAuthenticationMessage(packet);
                break;
            case ServerInBound.CLIENT_CIPHER_EXCHANGE:
                await this.onClientCipherExchangeMessage(packet);
                break;
            case ServerInBound.PING:
                await this.onPingMessage(packet);
                break;
            default:
                return false;
        }

        return true;
    }

    private async sendAuthenticationStatusPacket(
        statusPacketInfo: IAuthenticationStatusPacket,
    ): Promise<void> {
        if (!this.protocol) return;

        const statusPacket: AuthenticationStatus | undefined = this.protocol.getPacketBuilder(
            Packets.AuthenticationStatus,
        ) as AuthenticationStatus | undefined;

        if (statusPacket) {
            const packet = statusPacket.pack(statusPacketInfo);
            await this.sendMsg(packet);
        }
    }

    private async createAuthenticationFailureMessage(message: string): Promise<void> {
        await this.sendAuthenticationStatusPacket({
            status: OPNetAuthenticationStatus.ERROR,
            message: message,
        });
    }

    private async createFullAuthentication(): Promise<void> {
        if (!this.encryptem) return;
        if (this.encryptionStarted) {
            await this.disconnectPeer(1007);
            return;
        }

        await this.encryptem.generateServerCipherKeyPair();

        const statusMessage: IAuthenticationStatusPacket = {
            status: OPNetAuthenticationStatus.SUCCESS,
            message: 'Pre auth valid.',
        };

        await this.sendAuthenticationStatusPacket(statusMessage);

        if (this.timeoutAuth) {
            clearTimeout(this.timeoutAuth);
        }
    }

    private async sendServerHandshake(): Promise<void> {
        if (!this.encryptem) return;
        if (!this.protocol) return;

        if (this.encryptionStarted) {
            await this.disconnectPeer(1007);
            return;
        }

        const serverKey = this.encryptem.getServerPublicKey();
        const serverSigningCipher = this.encryptem.getServerSignaturePublicKey();

        if (!serverKey || !serverSigningCipher) {
            await this.disconnectPeer(1007);

            this.warn(
                `Failed to send server handshake. Server key or server signing cipher is null.`,
            );

            return;
        }

        const serverCipher: IServerKeyCipherExchangePacket = {
            serverKeyCipher: serverKey,
            serverSigningCipher: serverSigningCipher,
            encryptionEnabled: true,
        };

        const serverCipherPacket: ServerKeyCipherExchange | undefined =
            this.protocol.getPacketBuilder(Packets.ServerKeyCipherExchange) as
                | ServerKeyCipherExchange
                | undefined;

        if (serverCipherPacket) {
            const packet = serverCipherPacket.pack(serverCipher);
            await this.sendMsg(packet);

            this.encryptionStarted = true;
            this.encryptem.startEncryption();

            this.onAuthenticated();
        }
    }

    private async onPingMessage(packet: OPNetPacket): Promise<void> {
        if (!this.protocol) return;

        const pingPacket = await this.protocol.onIncomingPacket<IPingPacket>(packet);
        if (!pingPacket) {
            return;
        }

        const unpackedPingData = pingPacket.unpack(packet.packet);
        if (!unpackedPingData) {
            return;
        }

        const pongPacket: Pong | undefined = this.protocol.getPacketBuilder(Packets.Pong) as
            | Pong
            | undefined;

        if (!pongPacket) {
            return;
        }

        const responsePingData: IPingPacket = {
            timestamp: unpackedPingData.timestamp,
            lastPing: unpackedPingData.lastPing,
        };

        const responseBuffer = pongPacket.pack(responsePingData);
        await this.sendMsg(responseBuffer);
    }

    private async onClientCipherExchangeMessage(packet: OPNetPacket): Promise<void> {
        if (!this.protocol) return;
        if (!this.encryptem) return;

        const authPacket: ClientKeyCipherExchange | undefined =
            (await this.protocol.onIncomingPacket<IClientKeyCipherExchangePacket>(packet)) as
                | ClientKeyCipherExchange
                | undefined;

        if (!authPacket) {
            return;
        }

        const unpackedAuthData = authPacket.unpack(packet.packet);
        if (!unpackedAuthData) {
            return;
        }

        if (!(unpackedAuthData.clientKeyCipher && unpackedAuthData.clientAuthCipher)) {
            this.warn(`Peer (${this.peerId}) sent an invalid client authentication cipher.`);

            return await this.createAuthenticationFailureMessage(
                'Invalid client authentication cipher.',
            );
        }

        const clientKeyCipherBuffer = unpackedAuthData.clientKeyCipher as Buffer;
        const clientAuthCipherBuffer = unpackedAuthData.clientAuthCipher as Buffer;
        const clientIdentityBuffer = unpackedAuthData.identity as Buffer;

        console.log('auth request', {
            clientKeyCipherBuffer,
            clientAuthCipherBuffer,
            clientIdentityBuffer,
        });

        this.encryptem.setClientPublicKey(clientKeyCipherBuffer);

        // sha512
        if (clientIdentityBuffer.byteLength !== 64) {
            await this.disconnectPeer(1007, 'Invalid peer identity.');
            return;
        }

        // TODO: Verify peer identity.
        this._peerIdentity = Buffer.from(clientIdentityBuffer).toString('hex');

        // Accept the client's public key.
        await this.sendServerHandshake();
    }

    /** If the peer is using an outdated version of the protocol, we must compare to check if we can accept the version. */
    private canAcceptVersion(peerVersion: string): boolean {
        /** We must compare minor, major and patch versions. */

        const peerVersionSplit = peerVersion.split('.');
        const protocolVersionSplit = AuthenticationManager.CURRENT_PROTOCOL_VERSION.split('.');

        /** If the major version is different, we must reject the connection. */
        if (peerVersionSplit[0] !== protocolVersionSplit[0]) {
            return false;
        }

        /** If the minor version is different, we must reject the connection. */
        if (peerVersionSplit[1] !== protocolVersionSplit[1]) {
            return false;
        }

        /** If the patch version is different, we can accept the connection */
        return true;
    }

    private async onPassedVersionCheck(): Promise<void> {
        this.passVersionCheck = true;

        await this.createFullAuthentication();
    }

    private async onAuthenticationMessage(packet: OPNetPacket): Promise<void> {
        if (!this.protocol) return;
        if (!this.encryptem) return;

        if (this.passVersionCheck) {
            await this.disconnectPeer(1007, 'Peer has already passed the version check.');
            return;
        }

        const authPacket: AuthenticationPacket | undefined =
            (await this.protocol.onIncomingPacket<IAuthenticationPacket>(packet)) as
                | AuthenticationPacket
                | undefined;

        if (!authPacket) {
            return;
        }

        const unpackedAuthData = authPacket.unpack(packet.packet);
        if (!unpackedAuthData) {
            return;
        }

        if (!this.canAcceptVersion(unpackedAuthData.version)) {
            this.warn(`Peer (${this.peerId}) is using an outdated version of OPNet protocol.`);

            await this.disconnectPeer(1004, 'Outdated protocol version.');

            return;
        }

        this.log(`Peer (${this.peerId}) is using the latest version of the OPNet Protocol.`);
        if (!(unpackedAuthData.clientAuthCipher && unpackedAuthData.clientAuthCipher.length > 0)) {
            this.warn(`Peer (${this.peerId}) sent an invalid client authentication cipher.`);
            await this.createAuthenticationFailureMessage('Invalid client authentication cipher.');

            return;
        }

        await this.onPassedVersionCheck();
    }
}
