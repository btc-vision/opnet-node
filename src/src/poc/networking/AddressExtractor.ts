import { Multiaddr } from '@multiformats/multiaddr';

const IP_HOST_PROTOCOLS = new Set(['ip4', 'ip6']);
const DNS_HOST_PROTOCOLS = new Set(['dns', 'dns4', 'dns6', 'dnsaddr']);
const TRANSPORT_PROTOCOLS = new Set(['tcp', 'udp']);

interface ComponentLike {
    readonly name: string;
    readonly value?: string;
}

function getComponentsSafe(addr: Multiaddr): ComponentLike[] {
    try {
        if (typeof addr.getComponents === 'function') {
            return addr.getComponents();
        }
    } catch {
        // fall through to string parsing
    }

    try {
        const parts = addr.toString().split('/').filter(Boolean);
        const result: ComponentLike[] = [];
        let i = 0;
        while (i < parts.length) {
            const name = parts[i];
            const next = parts[i + 1];
            if (
                IP_HOST_PROTOCOLS.has(name) ||
                DNS_HOST_PROTOCOLS.has(name) ||
                TRANSPORT_PROTOCOLS.has(name)
            ) {
                result.push({ name, value: next ?? '' });
                i += 2;
            } else {
                result.push({ name, value: next ?? '' });
                i += 2;
            }
        }
        return result;
    } catch {
        return [];
    }
}

/**
 * Extracts the IP address or hostname from a Multiaddr.
 */
export function extractAddressHost(addr: Multiaddr): string | null {
    const components = getComponentsSafe(addr);

    for (const component of components) {
        if (IP_HOST_PROTOCOLS.has(component.name) || DNS_HOST_PROTOCOLS.has(component.name)) {
            return component.value || null;
        }
    }

    return null;
}

export function isUnspecifiedAddress(ip: string): boolean {
    return ip === '0.0.0.0' || ip === '::';
}

export function isLoopbackAddress(ip: string): boolean {
    return ip.startsWith('127.') || ip === '::1';
}

export function isPrivateOrLoopbackAddress(ip: string): boolean {
    if (isLoopbackAddress(ip)) return true;
    if (isUnspecifiedAddress(ip)) return true;

    if (
        ip.startsWith('10.') ||
        ip.startsWith('192.168.') ||
        ip.startsWith('169.254.') ||
        ip.startsWith('fe80:') ||
        ip.startsWith('fc00:') ||
        ip.startsWith('fd00:')
    ) {
        return true;
    }

    if (ip.startsWith('172.')) {
        const octets = ip.split('.');
        if (octets.length >= 2) {
            const second = parseInt(octets[1], 10);
            if (!Number.isNaN(second) && second >= 16 && second <= 31) return true;
        }
    }

    if (ip.startsWith('100.')) {
        const octets = ip.split('.');
        if (octets.length >= 2) {
            const second = parseInt(octets[1], 10);
            if (!Number.isNaN(second) && second >= 64 && second <= 127) return true;
        }
    }

    return false;
}

export function filterMultiaddrsLoopback(addrs: Multiaddr[]): Multiaddr[] {
    return addrs.filter((addr) => {
        const ip = extractAddressHost(addr);
        if (!ip) return false;

        return !isLoopbackAddress(ip) && !isUnspecifiedAddress(ip);
    });
}

export function filterMultiaddrsPrivate(addrs: Multiaddr[]): Multiaddr[] {
    return addrs.filter((addr) => {
        const ip = extractAddressHost(addr);
        if (!ip) return false;

        return !isPrivateOrLoopbackAddress(ip);
    });
}
