import { Multiaddr } from '@multiformats/multiaddr';

/**
 * Extracts the IP address or hostname from a Multiaddr
 * Replaces the deprecated nodeAddress() method
 */
export function extractIPAddress(addr: Multiaddr): string | null {
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

/**
 * Extracts IP/hostname and port from a Multiaddr
 * Returns an object similar to what nodeAddress() used to return
 */
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
