import { Logger } from '@btc-vision/bsi-common';
import { PeerInfo } from '@libp2p/interface';
import { Config } from '../../config/Config.js';
import { Libp2pInstance } from './interfaces/NodeType.js';

export class PeerChecker extends Logger {
    public readonly logColor: string = '#ff69b4';

    private isTryingPeers: boolean = false;

    private peersToTry: PeerInfo[] = [];
    private triedPeers: string[] = [];
    private maxConcurrentDials: number = 5;

    constructor(private readonly node: Libp2pInstance) {
        super();
    }

    public checkPeers(peersToTry: PeerInfo[]): void {
        for (const peer of peersToTry) {
            this.addToTryPeers(peer);
        }

        if (this.peersToTry.length) {
            void this.tryPeers();
        }
    }

    private async tryNextPeer(): Promise<void> {
        if (!this.node) {
            throw new Error('Node not initialized');
        }

        const peerData = this.peersToTry.shift();
        if (!peerData) {
            return;
        }

        const peerIdStr = peerData.id.toString();
        this.addTriedPeers(peerIdStr);

        await this.tryPeerData(peerData);
    }

    private addToTryPeers(peerData: PeerInfo): void {
        if (this.peersToTry.length > 100) {
            return; // ignore. have enough peers to try
        }

        const peerIdStr = peerData.id.toString();
        if (this.alreadyTriedPeer(peerIdStr)) {
            return;
        }

        if (!this.peersToTry.find((p) => p.id.toString() === peerIdStr)) {
            this.peersToTry.push(peerData);
        }
    }

    private async tryPeers(): Promise<void> {
        if (this.isTryingPeers) return;
        this.isTryingPeers = true;

        this.info(`Discovered ${this.peersToTry.length} new peer(s). Trying to connect...`);

        try {
            const promises: Promise<void>[] = [];
            for (let i = 0; i < this.maxConcurrentDials; i++) {
                promises.push(this.tryNextPeer());
            }

            await Promise.safeAll(promises);
        } catch (error) {
            this.error(`Error trying peers: ${error}`);
        } finally {
            this.isTryingPeers = false;
        }
    }

    private addTriedPeers(peerIdStr: string): void {
        if (this.triedPeers.length > 150) {
            this.triedPeers.shift();
        }

        if (!this.triedPeers.includes(peerIdStr)) {
            this.triedPeers.push(peerIdStr);
        }
    }

    private alreadyTriedPeer(peerIdStr: string): boolean {
        return this.triedPeers.includes(peerIdStr);
    }

    private async tryPeerData(peerData: PeerInfo): Promise<void> {
        if (!this.node) {
            throw new Error('Node not initialized');
        }

        try {
            const existingConnections = this.node.getConnections(peerData.id);
            if (existingConnections.length === 0) {
                const signal = AbortSignal.timeout(5000);
                await this.node.dial(peerData.id, { signal });

                if (Config.DEV_MODE) {
                    this.debug(`Successfully dialed peer ${peerData.id}`);
                }
            }

            await this.node.peerStore.merge(peerData.id, {
                multiaddrs: peerData.multiaddrs,
                tags: {
                    ['OPNET']: {
                        value: 50,
                        ttl: 128000,
                    },
                },
            });
        } catch (e) {
            if (Config.DEV_MODE) {
                this.error(`Failed to add/dial peer ${peerData.id}: ${e}`);
            }
        }
    }
}
