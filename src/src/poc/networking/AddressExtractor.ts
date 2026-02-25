import { Multiaddr } from '@multiformats/multiaddr';

/**
 * Extracts the IP address or hostname from a Multiaddr
 * Replaces the deprecated nodeAddress() method
 */
export function extractAddressHost(addr: Multiaddr): string | null {
    try {
        const components = addr.getComponents();

        for (const component of components) {
            if (component.name === 'ip4' || component.name === 'ip6') {
                return component.value || null;
            }

            if (
                component.name === 'dns' ||
                component.name === 'dns4' ||
                component.name === 'dns6' ||
                component.name === 'dnsaddr'
            ) {
                return component.value || null;
            }
        }

        return null;
    } catch {
        return null;
    }
}

export function extractNodeAddress(addr: Multiaddr): { address: string; port?: number } | null {
    try {
        const components = addr.getComponents();
        let address: string | null = null;
        let port: number | undefined;

        for (const component of components) {
            if (component.name === 'ip4' || component.name === 'ip6') {
                address = component.value || null;
            } else if (
                component.name === 'dns' ||
                component.name === 'dns4' ||
                component.name === 'dns6' ||
                component.name === 'dnsaddr'
            ) {
                address = component.value || null;
            } else if (component.name === 'tcp' || component.name === 'udp') {
                port = component.value ? parseInt(component.value, 10) : undefined;
            }
        }

        if (!address) return null;

        return { address, port };
    } catch {
        return null;
    }
}

export function isLoopbackAddress(ip: string): boolean {
    return ip.startsWith('127.') || ip === '::1' || ip === '0.0.0.0';
}

export function isPrivateOrLoopbackAddress(ip: string): boolean {
    if (isLoopbackAddress(ip)) return true;

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
        const second = parseInt(ip.split('.')[1], 10);

        if (second >= 16 && second <= 31) return true;
    }

    return false;
}

export function filterMultiaddrsLoopback(addrs: Multiaddr[]): Multiaddr[] {
    return addrs.filter((addr) => {
        const ip = extractAddressHost(addr);
        if (!ip) return true;

        return !isLoopbackAddress(ip);
    });
}

export function filterMultiaddrsPrivate(addrs: Multiaddr[]): Multiaddr[] {
    return addrs.filter((addr) => {
        const ip = extractAddressHost(addr);
        if (!ip) return false;

        return !isPrivateOrLoopbackAddress(ip);
    });
}
