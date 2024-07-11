import { BitcoinNetwork } from '@btc-vision/bsi-common';
import bitcoin, { Network } from 'bitcoinjs-lib';

export class NetworkConverter {
    public static getNetwork(network: BitcoinNetwork): Network {
        switch (network) {
            case BitcoinNetwork.Mainnet:
                return bitcoin.networks.bitcoin;
            case BitcoinNetwork.TestNet:
                return bitcoin.networks.testnet;
            case BitcoinNetwork.Regtest:
                return bitcoin.networks.regtest;
            default:
                throw new Error(`Invalid network ${network}`);
        }
    }
}
