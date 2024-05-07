import { Logger } from '@btc-vision/bsi-common';
import { PeerId } from '@libp2p/interface';
import { IdentifyResult } from '@libp2p/interface/src';
import { OPNetIdentity } from '../identity/OPNetIdentity.js';
import { ClientPeerNetworkingManager } from '../networking/client/ClientPeerNetworkingManager.js';
import { ServerPeerNetworkingManager } from '../networking/server/managers/ServerPeerNetworkingManager.js';

export class OPNetPeer extends Logger {
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

        this.serverNetworkingManager = new ServerPeerNetworkingManager(this.peerIdString);
        this.serverNetworkingManager.disconnectPeer = this.disconnect.bind(this);
        this.serverNetworkingManager.send = async (data: Uint8Array | Buffer) => {
            // to client
            data = Buffer.concat([Buffer.from([0x01]), Buffer.from(data)]);

            return this.sendInternal(data);
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
    }

    private get peerIdentity(): IdentifyResult {
        if (!this._peerIdentity) {
            throw new Error('Peer identity not found.');
        }

        return this._peerIdentity;
    }

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

            await this.destroy();
        }

        /*const promises: Promise<boolean>[] = [
            this.clientNetworkingManager.onMessage(rawBuf),
            this.serverNetworkingManager.onMessage(rawBuf),
        ];

        const resp = await Promise.all(promises);
        const processed = resp[0] || resp[1];

        if(!processed) {
            this.warn(`[PEER] Unknown opcode: ${opcode}`);
        }*/
    }

    public disconnectPeer: (peerId: PeerId) => Promise<void> = () => {
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

        if (shouldDisconnect) await this.disconnect(1007, 'Goodbye!');
        this.clientNetworkingManager.destroy();

        delete this._peerIdentity;
    }

    protected async sendInternal(data: Uint8Array | Buffer): Promise<void> {
        if (this.isDestroyed) return;

        await this.sendMsg(this.peerId, data);
    }

    protected async disconnect(code: number, reason?: string): Promise<void> {
        if (this.isDestroyed) return;

        this.debug(`Disconnecting peer ${this.peerId} with code ${code} and reason ${reason}.`);
        await this.disconnectPeer(this.peerId);
    }
}
