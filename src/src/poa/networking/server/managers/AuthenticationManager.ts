import { ChainIds } from '../../../../config/enums/ChainIds.js';
import { TRUSTED_CHECKSUM } from '../../../configurations/P2PVersion.js';
import { OPNetIdentity } from '../../../identity/OPNetIdentity.js';
import { EncryptemServer } from '../../encryptem/EncryptemServer.js';
import { DisconnectionCode } from '../../enums/DisconnectionCode.js';
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
import { TrustedVersion } from '../../../configurations/version/TrustedVersion.js';

export abstract class AuthenticationManager extends SharedAuthenticationManager {
    private static readonly VERIFY_NETWORK: boolean = true;

    public clientVersion: string | undefined;
    public clientChecksum: string | undefined;

    public clientIndexerMode: number | undefined;
    public clientNetwork: number | undefined;
    public clientChainId: ChainIds | undefined;

    protected isAuthenticated: boolean = false;
    protected abstract readonly peerId: string;

    private passVersionCheck: boolean = false;
    private timeoutAuth: NodeJS.Timeout | null = null;
    private identityChallenge: Uint8Array | Buffer | undefined;

    protected constructor(selfIdentity: OPNetIdentity | undefined) {
        super(selfIdentity);
    }

    private _clientIdentity: string | undefined;

    public get clientIdentity(): string {
        if (!this._clientIdentity) {
            throw new Error(`Peer identity not defined.`);
        }

        return this._clientIdentity;
    }

    public get hasAuthenticated(): boolean {
        return this.isAuthenticated;
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
            void this.disconnectPeer(DisconnectionCode.AUTH_TIMED_OUT, 'Authentication timeout.');
        }, 30000);
    }

    protected override onAuthenticated(): void {
        if (!this.protocol) {
            throw new Error(`Protocol not found.`);
        }

        this.protocol.onAuthenticated();

        super.onAuthenticated();
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
            await this.disconnectPeer(DisconnectionCode.BAD_ENCRYPTION);
            return;
        }

        await this.encryptem.generateServerCipherKeyPair();

        this.generateChallenge();

        const statusMessage: IAuthenticationStatusPacket = {
            status: OPNetAuthenticationStatus.SUCCESS,
            message: 'Pre auth valid.',
            challenge: this.identityChallenge,
        };

        await this.sendAuthenticationStatusPacket(statusMessage);

        if (this.timeoutAuth) {
            clearTimeout(this.timeoutAuth);
        }
    }

    private generateChallenge(): void {
        if (this.identityChallenge) {
            throw new Error(`Challenge already set.`);
        }

        const challenge = crypto.getRandomValues(new Uint8Array(128));
        this.identityChallenge = Buffer.from(challenge);
    }

    private async sendServerHandshake(): Promise<void> {
        if (!this.encryptem) return;
        if (!this.protocol) return;

        if (this.encryptionStarted) {
            await this.disconnectPeer(DisconnectionCode.BAD_ENCRYPTION);
            return;
        }

        const serverKey = this.encryptem.getServerPublicKey();
        const serverSigningCipher = this.encryptem.getServerSignaturePublicKey();

        if (!serverKey || !serverSigningCipher) {
            await this.disconnectPeer(DisconnectionCode.BAD_PACKET);

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
        const challengeResponse = unpackedAuthData.challenge;

        // sha512
        if (clientIdentityBuffer.byteLength !== 64) {
            await this.disconnectPeer(DisconnectionCode.BAD_IDENTITY, 'Invalid peer identity.');
            return;
        }

        /** We verify that the client's signature public key is the same as the one we have stored. */
        const isValidSign = await this.verifySignaturePublicKey(clientAuthCipherBuffer);
        if (!isValidSign) {
            return;
        }

        /** We must verify the identity of the peer. */
        const isValidChallenge = await this.verifyChallenge(
            clientAuthCipherBuffer,
            challengeResponse,
        );
        if (!isValidChallenge) {
            return;
        }

        // TODO: Verify peer identity.
        this._clientIdentity = Buffer.from(clientIdentityBuffer).toString('hex');

        this.encryptem.setClientPublicKey(clientKeyCipherBuffer);

        // Send the server handshake response.
        await this.sendServerHandshake();
        this.isAuthenticated = true;
    }

    private async verifySignaturePublicKey(signaturePubKey: Uint8Array | Buffer): Promise<boolean> {
        const encryptemSignaturePubKey = this.encryptem.getClientSignaturePublicKey();
        if (!encryptemSignaturePubKey) {
            await this.disconnectPeer(
                DisconnectionCode.BAD_AUTH_CIPHER,
                'Invalid client authentication cipher. Signature public key not found.',
            );
            return false;
        }

        if (!encryptemSignaturePubKey.equals(signaturePubKey)) {
            await this.disconnectPeer(
                DisconnectionCode.BAD_AUTH_CIPHER,
                'Invalid client authentication cipher. Signature public key mismatch.',
            );
            return false;
        }

        return true;
    }

    private async verifyChallenge(
        signaturePubKey: Uint8Array | Buffer,
        challengeResponse: Uint8Array | Buffer,
    ): Promise<boolean> {
        if (!this.identityChallenge) {
            throw new Error(`Challenge not set.`);
        }

        if (!this.selfIdentity) {
            throw new Error(`Self identity not found.`);
        }

        if (!challengeResponse || !this.identityChallenge) {
            await this.disconnectPeer(
                DisconnectionCode.BAD_CHALLENGE,
                'Malformed challenge response.',
            );
            return false;
        }

        const isValid: boolean = this.selfIdentity.verifyChallenge(
            this.identityChallenge,
            challengeResponse,
            signaturePubKey,
        );

        if (!isValid) {
            await this.disconnectPeer(
                DisconnectionCode.BAD_CHALLENGE,
                'Invalid challenge response.',
            );
            return false;
        }

        return true;
    }

    /** If the peer is using an outdated version of the protocol, we must compare to check if we can accept the version. */
    private mayAcceptVersion(peerVersion: string): boolean {
        /** We must compare minor, major and patch versions. */

        const peerVersionSplit = peerVersion.split('.');
        const protocolVersionSplit = AuthenticationManager.CURRENT_PROTOCOL_VERSION.split('.');

        /** If the major version is different, we must reject the connection. */
        if (peerVersionSplit[0] !== protocolVersionSplit[0]) {
            return false;
        }

        /** If the minor version is lower than the protocol version, we must reject the connection. */
        if (peerVersionSplit[1] < protocolVersionSplit[1]) {
            return false;
        }

        /** If the patch version is different, we can accept the connection */
        return true;
    }

    private async onPassedVersionCheck(): Promise<void> {
        this.passVersionCheck = true;

        await this.createFullAuthentication();
    }

    private mayAcceptTrustedChecksum(
        peerVersion: TrustedVersion,
        trustedChecksum: string,
    ): boolean {
        const requestedVersionChecksum: string = TRUSTED_CHECKSUM[peerVersion];
        if (!requestedVersionChecksum) {
            return false;
        }

        return requestedVersionChecksum !== trustedChecksum;
    }

    private async verifyNetwork(): Promise<void> {
        if (!this.selfIdentity) throw new Error('(verifyNetwork) Self identity not found.');

        if (this.selfIdentity.peerNetwork !== this.clientNetwork) {
            await this.disconnectPeer(DisconnectionCode.BAD_NETWORK, 'Invalid network.');
            return;
        }

        if (this.selfIdentity.peerChainId !== this.clientChainId) {
            await this.disconnectPeer(DisconnectionCode.BAD_CHAIN_ID, 'Invalid chain ID.');
            return;
        }
    }

    private async onAuthenticationMessage(packet: OPNetPacket): Promise<void> {
        if (!this.protocol) return;
        if (!this.encryptem) return;

        if (this.passVersionCheck) {
            await this.disconnectPeer(
                DisconnectionCode.BAD_VERSION,
                'Peer has already passed the version check.',
            );
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

        if (!this.mayAcceptVersion(unpackedAuthData.version)) {
            this.warn(`Peer (${this.peerId}) is using an outdated version of OPNet protocol.`);

            await this.disconnectPeer(DisconnectionCode.BAD_VERSION, 'Outdated protocol version.');

            return;
        }

        if (
            this.mayAcceptTrustedChecksum(
                unpackedAuthData.version,
                unpackedAuthData.trustedChecksum,
            )
        ) {
            this.warn(`Peer (${this.peerId}) has an invalid trusted checksum.`);
            await this.disconnectPeer(
                DisconnectionCode.BAD_TRUSTED_CHECKSUM,
                'Invalid trusted checksum.',
            );
            return;
        }

        if (!(unpackedAuthData.clientAuthCipher && unpackedAuthData.clientAuthCipher.length > 0)) {
            this.warn(`Peer (${this.peerId}) sent an invalid client authentication cipher.`);
            await this.createAuthenticationFailureMessage('Invalid client authentication cipher.');

            return;
        }

        if (unpackedAuthData.clientAuthCipher.byteLength !== 32) {
            await this.disconnectPeer(
                DisconnectionCode.BAD_AUTH_CIPHER,
                'Invalid client authentication cipher. Invalid length.',
            );
            return;
        }

        this.clientVersion = unpackedAuthData.version;
        this.clientChecksum = unpackedAuthData.trustedChecksum;
        this.clientNetwork = unpackedAuthData.network;
        this.clientIndexerMode = unpackedAuthData.type;
        this.clientChainId = unpackedAuthData.chainId;

        if (AuthenticationManager.VERIFY_NETWORK) {
            await this.verifyNetwork();
        }

        this.encryptem.setClientSignaturePublicKey(Buffer.from(unpackedAuthData.clientAuthCipher));
        await this.onPassedVersionCheck();
    }
}
