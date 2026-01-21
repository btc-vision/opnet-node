import { Logger } from '@btc-vision/bsi-common';
import { PeerId, PeerInfo } from '@libp2p/interface';
import { Config } from '../../config/Config.js';
import { Libp2pInstance } from './interfaces/NodeType.js';

interface DialFailureEntry {
    failures: number;
    lastAttempt: number;
}

export class PeerChecker extends Logger {
    public readonly logColor: string = '#ff69b4';

    /** Maximum number of dial failures before a peer is considered unreachable */
    private static readonly MAX_DIAL_FAILURES: number = 20;
    /** Time in ms after which dial failure count resets (1 hour) */
    private static readonly DIAL_FAILURE_RESET_TIME: number = 60 * 60 * 1000;

    private isTryingPeers: boolean = false;

    private peersToTry: PeerInfo[] = [];
    private triedPeers: string[] = [];
    private maxConcurrentDials: number = 5;

    /** Tracks dial failures per peer to avoid retrying unreachable peers indefinitely */
    private dialFailures: Map<string, DialFailureEntry> = new Map();

    constructor(
        private readonly node: Libp2pInstance,
        private readonly onPeerUnreachable?: (peerId: PeerId) => Promise<void>,
    ) {
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

        // Skip peers that have exceeded failure threshold
        if (this.isPeerUnreachable(peerIdStr)) {
            return;
        }

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

    /**
     * Check if a peer has exceeded the maximum dial failure threshold
     */
    public isPeerUnreachable(peerIdStr: string): boolean {
        const entry = this.dialFailures.get(peerIdStr);
        if (!entry) return false;

        // Reset failure count if enough time has passed
        if (Date.now() - entry.lastAttempt > PeerChecker.DIAL_FAILURE_RESET_TIME) {
            this.dialFailures.delete(peerIdStr);
            return false;
        }

        return entry.failures >= PeerChecker.MAX_DIAL_FAILURES;
    }

    /**
     * Record a dial failure for a peer
     * @returns true if the peer has now exceeded the failure threshold
     */
    private recordDialFailure(peerIdStr: string): boolean {
        const existing = this.dialFailures.get(peerIdStr);
        const now = Date.now();

        // Reset if last attempt was long ago
        if (existing && now - existing.lastAttempt > PeerChecker.DIAL_FAILURE_RESET_TIME) {
            this.dialFailures.delete(peerIdStr);
        }

        const entry = this.dialFailures.get(peerIdStr) || { failures: 0, lastAttempt: now };
        entry.failures++;
        entry.lastAttempt = now;
        this.dialFailures.set(peerIdStr, entry);

        return entry.failures >= PeerChecker.MAX_DIAL_FAILURES;
    }

    /**
     * Reset dial failure count for a peer (called on successful connection)
     */
    public resetDialFailures(peerIdStr: string): void {
        this.dialFailures.delete(peerIdStr);
    }

    /**
     * Record a dial failure from external code (e.g., monitorConnectionHealth).
     * This allows failure tracking to be centralized even for dials not made by PeerChecker.
     * @returns true if the peer has now exceeded the failure threshold
     */
    public async recordExternalDialFailure(peerId: PeerId): Promise<boolean> {
        const peerIdStr = peerId.toString();
        const exceededThreshold = this.recordDialFailure(peerIdStr);

        if (exceededThreshold) {
            this.warn(
                `Peer ${peerIdStr} exceeded dial failure threshold (${PeerChecker.MAX_DIAL_FAILURES} attempts), marking as unreachable`,
            );

            if (this.onPeerUnreachable) {
                await this.onPeerUnreachable(peerId);
            }
        }

        return exceededThreshold;
    }

    private async tryPeerData(peerData: PeerInfo): Promise<void> {
        if (!this.node) {
            throw new Error('Node not initialized');
        }

        const peerIdStr = peerData.id.toString();

        // Skip peers that have exceeded failure threshold
        if (this.isPeerUnreachable(peerIdStr)) {
            return;
        }

        try {
            const existingConnections = this.node.getConnections(peerData.id);
            if (existingConnections.length === 0) {
                const signal = AbortSignal.timeout(5000);
                await this.node.dial(peerData.id, { signal });

                if (Config.DEV_MODE) {
                    this.debug(`Successfully dialed peer ${peerData.id}`);
                }

                // Reset failure count on successful dial
                this.resetDialFailures(peerIdStr);
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

            // Record the failure and check if threshold exceeded
            const exceededThreshold = this.recordDialFailure(peerIdStr);
            if (exceededThreshold) {
                this.warn(
                    `Peer ${peerIdStr} exceeded dial failure threshold (${PeerChecker.MAX_DIAL_FAILURES} attempts), marking as unreachable`,
                );

                // Notify P2PManager to handle the unreachable peer
                if (this.onPeerUnreachable) {
                    await this.onPeerUnreachable(peerData.id);
                }
            }
        }
    }
}
