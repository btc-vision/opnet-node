import { BitcoinNetworkRequest } from '@btc-vision/op-vm';

export function getChainIdHex(network: BitcoinNetworkRequest): string {
    switch (network) {
        case BitcoinNetworkRequest.Mainnet:
            return '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
        case BitcoinNetworkRequest.Testnet:
            return '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943';
        case BitcoinNetworkRequest.Regtest:
            return '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206';
        default:
            throw new Error('Unknown network');
    }
}

export function getChainId(network: BitcoinNetworkRequest): Uint8Array {
    return Uint8Array.from(Buffer.from(getChainIdHex(network), 'hex'));
}
