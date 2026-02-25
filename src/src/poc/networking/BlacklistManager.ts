import { PeerId } from '@libp2p/interface';
import { Multiaddr } from '@multiformats/multiaddr';
import { LevelDatastore } from 'datastore-level';
import { Key } from 'interface-datastore';
import { DisconnectionCode } from './enums/DisconnectionCode.js';
import { extractAddressHost } from './AddressExtractor.js';
import { Logger } from '@btc-vision/bsi-common';

export interface BlacklistEntry {
    peerId?: string;
    ipAddress?: string;
    reason: DisconnectionCode;
    timestamp: number;
    permanent: boolean;
    expiresAt?: number;
    attempts: number;
    metadata?: {
        lastSeenAddress?: string;
        violations?: DisconnectionCode[];
    };
}

export class BlacklistManager extends Logger {
    private static readonly BLACKLIST_PREFIX = '/blacklist/';
    private static readonly PEER_PREFIX = '/blacklist/peer/';
    private static readonly IP_PREFIX = '/blacklist/ip/';
    private static readonly DEFAULT_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours
    private static readonly PERMANENT_REASONS = [
        DisconnectionCode.BAD_CHECKSUM,
        DisconnectionCode.BAD_SIGNATURE,
        DisconnectionCode.BAD_BEHAVIOR,
        DisconnectionCode.INVALID_CHAIN,
    ];

    public readonly logColor: string = '#8800ff';
    private peerBlacklist: Map<string, BlacklistEntry> = new Map();
    private ipBlacklist: Map<string, BlacklistEntry> = new Map();
    private readonly datastore: LevelDatastore | undefined;

    constructor(datastore?: LevelDatastore) {
        super();

        this.datastore = datastore;
        this.startCleanupInterval();
    }

    public async init(): Promise<void> {
        if (!this.datastore) return;

        try {
            await this.loadBlacklistFromDatastore();
            this.info(
                `Loaded ${this.peerBlacklist.size} peer blacklist entries and ${this.ipBlacklist.size} IP blacklist entries`,
            );
        } catch (error) {
            this.error(`Failed to load blacklist from datastore: ${error}`);
        }
    }

    public async blacklistPeer(
        peerId: PeerId | string,
        reason: DisconnectionCode,
        addresses?: Multiaddr[],
        permanent?: boolean,
    ): Promise<void> {
        const peerIdStr = typeof peerId === 'string' ? peerId : peerId.toString();

        const existingEntry = this.peerBlacklist.get(peerIdStr);
        const isPermanent = permanent ?? BlacklistManager.PERMANENT_REASONS.includes(reason);

        const entry: BlacklistEntry = {
            peerId: peerIdStr,
            reason,
            timestamp: Date.now(),
            permanent: isPermanent,
            expiresAt: isPermanent ? undefined : Date.now() + BlacklistManager.DEFAULT_EXPIRY,
            attempts: existingEntry ? existingEntry.attempts + 1 : 1,
            metadata: {
                lastSeenAddress: addresses?.[0]?.toString(),
                violations: existingEntry?.metadata?.violations
                    ? [...existingEntry.metadata.violations, reason]
                    : [reason],
            },
        };

        this.peerBlacklist.set(peerIdStr, entry);
        await this.persistEntry(BlacklistManager.PEER_PREFIX + peerIdStr, entry);

        // Also blacklist associated IP addresses
        if (addresses) {
            for (const addr of addresses) {
                const ip = extractAddressHost(addr);
                if (ip) {
                    await this.blacklistIP(ip, reason, permanent);
                }
            }
        }

        this.warn(
            `Blacklisted peer ${peerIdStr} for reason: ${reason} (permanent: ${isPermanent}, attempts: ${entry.attempts})`,
        );
    }

    public async blacklistIP(
        ip: string,
        reason: DisconnectionCode,
        permanent?: boolean,
    ): Promise<void> {
        const isPermanent = permanent ?? BlacklistManager.PERMANENT_REASONS.includes(reason);

        const existingEntry = this.ipBlacklist.get(ip);
        const entry: BlacklistEntry = {
            ipAddress: ip,
            reason,
            timestamp: Date.now(),
            permanent: isPermanent,
            expiresAt: isPermanent ? undefined : Date.now() + BlacklistManager.DEFAULT_EXPIRY,
            attempts: existingEntry ? existingEntry.attempts + 1 : 1,
        };

        this.ipBlacklist.set(ip, entry);
        await this.persistEntry(BlacklistManager.IP_PREFIX + ip, entry);

        this.warn(`Blacklisted IP ${ip} for reason: ${reason} (permanent: ${isPermanent})`);
    }

    public isPeerBlacklisted(peerId: PeerId | string): boolean {
        const peerIdStr = typeof peerId === 'string' ? peerId : peerId.toString();
        const entry = this.peerBlacklist.get(peerIdStr);

        if (!entry) return false;

        // Check if temporary blacklist has expired
        if (!entry.permanent && entry.expiresAt && entry.expiresAt < Date.now()) {
            this.peerBlacklist.delete(peerIdStr);
            void this.removeEntry(BlacklistManager.PEER_PREFIX + peerIdStr);
            return false;
        }

        return true;
    }

    public isIPBlacklisted(ip: string): boolean {
        const entry = this.ipBlacklist.get(ip);

        if (!entry) return false;

        // Check if temporary blacklist has expired
        if (!entry.permanent && entry.expiresAt && entry.expiresAt < Date.now()) {
            this.ipBlacklist.delete(ip);
            void this.removeEntry(BlacklistManager.IP_PREFIX + ip);
            return false;
        }

        return true;
    }

    public isAddressBlacklisted(multiaddr: Multiaddr): boolean {
        const ip = extractAddressHost(multiaddr);
        return ip ? this.isIPBlacklisted(ip) : false;
    }

    public async shouldDenyConnection(peerId: PeerId, multiaddr?: Multiaddr): Promise<boolean> {
        // Check peer ID blacklist
        if (this.isPeerBlacklisted(peerId)) {
            const entry = this.peerBlacklist.get(peerId.toString());
            if (entry && entry.attempts > 3) {
                // Upgrade to permanent after 3 attempts
                entry.permanent = true;
                await this.persistEntry(BlacklistManager.PEER_PREFIX + peerId.toString(), entry);
            }
            return true;
        }

        // Check IP blacklist
        if (multiaddr) {
            const ip = extractAddressHost(multiaddr);
            if (ip && this.isIPBlacklisted(ip)) {
                return true;
            }
        }

        return false;
    }

    public async whitelistPeer(peerId: PeerId | string): Promise<void> {
        const peerIdStr = typeof peerId === 'string' ? peerId : peerId.toString();

        if (this.peerBlacklist.has(peerIdStr)) {
            this.peerBlacklist.delete(peerIdStr);
            await this.removeEntry(BlacklistManager.PEER_PREFIX + peerIdStr);
            this.info(`Whitelisted peer ${peerIdStr}`);
        }
    }

    public async whitelistIP(ip: string): Promise<void> {
        if (this.ipBlacklist.has(ip)) {
            this.ipBlacklist.delete(ip);
            await this.removeEntry(BlacklistManager.IP_PREFIX + ip);
            this.info(`Whitelisted IP ${ip}`);
        }
    }

    public getBlacklistStats(): {
        totalPeers: number;
        totalIPs: number;
        permanentPeers: number;
        temporaryPeers: number;
        reasonBreakdown: Record<string, number>;
    } {
        const reasonBreakdown: Record<string, number> = {};
        let permanentPeers = 0;
        let temporaryPeers = 0;

        for (const entry of this.peerBlacklist.values()) {
            if (entry.permanent) permanentPeers++;
            else temporaryPeers++;

            reasonBreakdown[entry.reason] = (reasonBreakdown[entry.reason] || 0) + 1;
        }

        return {
            totalPeers: this.peerBlacklist.size,
            totalIPs: this.ipBlacklist.size,
            permanentPeers,
            temporaryPeers,
            reasonBreakdown,
        };
    }

    private async loadBlacklistFromDatastore(): Promise<void> {
        if (!this.datastore) return;

        try {
            // Load peer blacklist
            const peerQuery = {
                prefix: BlacklistManager.PEER_PREFIX,
            };

            for await (const pair of this.datastore.query(peerQuery)) {
                try {
                    const entry = JSON.parse(
                        new TextDecoder().decode(pair.value),
                    ) as BlacklistEntry;
                    if (entry.peerId) {
                        // Only load if not expired
                        if (entry.permanent || !entry.expiresAt || entry.expiresAt > Date.now()) {
                            this.peerBlacklist.set(entry.peerId, entry);
                        }
                    }
                } catch (error) {
                    this.error(
                        `Failed to parse blacklist entry for key ${pair.key.toString()}: ${error}`,
                    );
                }
            }

            // Load IP blacklist
            const ipQuery = {
                prefix: BlacklistManager.IP_PREFIX,
            };

            for await (const pair of this.datastore.query(ipQuery)) {
                try {
                    const entry = JSON.parse(
                        new TextDecoder().decode(pair.value),
                    ) as BlacklistEntry;
                    if (entry.ipAddress) {
                        // Only load if not expired
                        if (entry.permanent || !entry.expiresAt || entry.expiresAt > Date.now()) {
                            this.ipBlacklist.set(entry.ipAddress, entry);
                        }
                    }
                } catch (error) {
                    this.error(
                        `Failed to parse blacklist entry for key ${pair.key.toString()}: ${error}`,
                    );
                }
            }
        } catch (error) {
            this.error(`Failed to query datastore: ${error}`);
        }
    }

    private async persistEntry(key: string, entry: BlacklistEntry): Promise<void> {
        if (!this.datastore) return;

        try {
            const dataKey = new Key(key);
            const value = new TextEncoder().encode(JSON.stringify(entry));
            await this.datastore.put(dataKey, value);
        } catch (error) {
            this.error(`Failed to persist blacklist entry: ${error}`);
        }
    }

    private async removeEntry(key: string): Promise<void> {
        if (!this.datastore) return;

        try {
            const dataKey = new Key(key);
            await this.datastore.delete(dataKey);
        } catch (error) {
            // Ignore delete errors
        }
    }

    private startCleanupInterval(): void {
        setInterval(() => {
            this.cleanupExpiredEntries();
        }, 60_000); // Clean up every minute
    }

    private cleanupExpiredEntries(): void {
        const now = Date.now();
        let cleanedPeers = 0;
        let cleanedIPs = 0;

        // Clean peer blacklist
        for (const [peerId, entry] of this.peerBlacklist.entries()) {
            if (!entry.permanent && entry.expiresAt && entry.expiresAt < now) {
                this.peerBlacklist.delete(peerId);
                void this.removeEntry(BlacklistManager.PEER_PREFIX + peerId);
                cleanedPeers++;
            }
        }

        // Clean IP blacklist
        for (const [ip, entry] of this.ipBlacklist.entries()) {
            if (!entry.permanent && entry.expiresAt && entry.expiresAt < now) {
                this.ipBlacklist.delete(ip);
                void this.removeEntry(BlacklistManager.IP_PREFIX + ip);
                cleanedIPs++;
            }
        }

        if (cleanedPeers > 0 || cleanedIPs > 0) {
            this.debug(
                `Cleaned up ${cleanedPeers} expired peer entries and ${cleanedIPs} expired IP entries`,
            );
        }
    }
}
