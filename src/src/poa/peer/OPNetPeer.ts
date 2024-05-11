import { Logger } from '@btc-vision/bsi-common';
import { PeerId } from '@libp2p/interface';
import { IdentifyResult } from '@libp2p/interface/src';
import { ChainIds } from '../../config/enums/ChainIds.js';
import { OPNetIdentity } from '../identity/OPNetIdentity.js';
import { ClientPeerNetworkingManager } from '../networking/client/ClientPeerNetworkingManager.js';
import { DisconnectionCode } from '../networking/enums/DisconnectionCode.js';
import { OPNetPeerInfo } from '../networking/protobuf/packets/peering/DiscoveryResponsePacket.js';
import { ServerPeerNetworkingManager } from '../networking/server/managers/ServerPeerNetworkingManager.js';

export class OPNetPeer extends Logger {
    public isAuthenticated: boolean = false;

    private readonly peerId: PeerId;
    private readonly peerIdString: string;

    private isDestroyed: boolean = false;

    private clientNetworkingManager: ClientPeerNetworkingManager;
    private serverNetworkingManager: ServerPeerNetworkingManager;

    constructor(
        private _peerIdentity: IdentifyResult | undefined,
        private selfIdentity: OPNetIdentity | undefined,
    ) {
        super();

        this.peerId = this.peerIdentity.peerId;
        this.peerIdString = this.peerId.toString();

        this.serverNetworkingManager = new ServerPeerNetworkingManager(
            this.peerIdString,
            this.selfIdentity,
        );

        this.serverNetworkingManager.disconnectPeer = this.disconnect.bind(this);
        this.serverNetworkingManager.send = async (data: Uint8Array | Buffer) => {
            // to client
            data = Buffer.concat([Buffer.from([0x01]), Buffer.from(data)]);

            return this.sendInternal(data);
        };
        this.serverNetworkingManager.onServerAuthenticationCompleted = () => {
            this.onServerAuthenticationCompleted();
        };

        this.serverNetworkingManager.getOPNetPeers = (): OPNetPeerInfo[] => {
            return this.getOPNetPeers();
        };

        this.clientNetworkingManager = new ClientPeerNetworkingManager(
            this.peerIdString,
            this.selfIdentity,
        );

        this.clientNetworkingManager.disconnectPeer = this.disconnect.bind(this);
        this.clientNetworkingManager.send = async (data: Uint8Array | Buffer) => {
            // to server
            data = Buffer.concat([Buffer.from([0x00]), Buffer.from(data)]);

            return this.sendInternal(data);
        };
        this.clientNetworkingManager.onClientAuthenticationCompleted = () => {
            this.onClientAuthenticationCompleted();
        };
    }

    public get clientIdentity(): string | undefined {
        return this.serverNetworkingManager.clientIdentity;
    }

    public get clientIndexerMode(): number | undefined {
        return this.serverNetworkingManager.clientIndexerMode;
    }

    public get clientNetwork(): number | undefined {
        return this.serverNetworkingManager.clientNetwork;
    }

    public get clientChainId(): ChainIds | undefined {
        return this.serverNetworkingManager.clientChainId;
    }

    public get clientChecksum(): string | undefined {
        return this.serverNetworkingManager.clientChecksum;
    }

    public get clientVersion(): string | undefined {
        return this.serverNetworkingManager.clientVersion;
    }

    private get peerIdentity(): IdentifyResult {
        if (!this._peerIdentity) {
            throw new Error('Peer identity not found.');
        }

        return this._peerIdentity;
    }

    public getOPNetPeers: () => OPNetPeerInfo[] = () => {
        throw new Error('getOPNetPeers not implemented.');
    };

    public reportAuthenticatedPeer: (peerId: PeerId) => void = () => {
        throw new Error('Method not implemented.');
    };

    public authenticate(): Promise<void> {
        return this.clientNetworkingManager.login();
    }

    public async init(): Promise<void> {
        this.log(`Creating peer ${this.peerIdString}.`);
    }

    public sendMsg: (peerId: PeerId, data: Uint8Array | Buffer) => Promise<void> = async () => {
        throw new Error('Method not implemented.');
    };

    public async onMessage(rawBuf: ArrayBuffer): Promise<void> {
        try {
            const buffer: Uint8Array = new Uint8Array(rawBuf);
            const toClient = buffer.slice(0, 1)[0] === 0x01;

            let success = false;
            switch (toClient) {
                case true:
                    success = await this.clientNetworkingManager.onMessage(buffer.slice(1));
                    break;
                case false:
                    success = await this.serverNetworkingManager.onMessage(buffer.slice(1));
                    break;
            }

            if (!success) {
                throw new Error(`Unknown opcode received. ${buffer[1]}`);
            }
        } catch (e) {
            console.log(e);

            await this.disconnect(DisconnectionCode.BAD_PACKET, 'Bad packet.');
            await this.destroy(false);
        }
    }

    public disconnectPeer: (
        peerId: PeerId,
        code: DisconnectionCode,
        reason?: string,
    ) => Promise<void> = () => {
        throw new Error('Method not implemented.');
    };

    public async onDisconnect(): Promise<void> {
        this.log(`Peer ${this.peerId} disconnected.`);

        await this.destroy(false);
    }

    public async destroy(shouldDisconnect: boolean = true): Promise<void> {
        if (this.isDestroyed) return;
        this.isDestroyed = true;
        this.selfIdentity = undefined;

        if (shouldDisconnect) await this.disconnect(DisconnectionCode.BAD_BEHAVIOR, 'Goodbye!');
        this.clientNetworkingManager.destroy();

        delete this._peerIdentity;
    }

    protected async sendInternal(data: Uint8Array | Buffer): Promise<void> {
        if (this.isDestroyed) return;

        await this.sendMsg(this.peerId, data);
    }

    protected async disconnect(code: DisconnectionCode, reason?: string): Promise<void> {
        if (this.isDestroyed) return;

        this.isAuthenticated = false;

        this.debug(`Disconnecting peer ${this.peerId} with code ${code} and reason ${reason}.`);
        await this.disconnectPeer(this.peerId, code, reason);
    }

    private onServerAuthenticationCompleted(): void {}

    private onClientAuthenticationCompleted(): void {
        this.isAuthenticated = true;

        this.reportAuthenticatedPeer(this.peerId);
    }
}
