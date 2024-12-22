import bitcoin, { Network } from '@btc-vision/bitcoin';
import { Config } from '../Config.js';
import { BitcoinNetwork } from './BitcoinNetwork.js';
import { ChainIds } from '../enums/ChainIds.js';

export class NetworkConverter {
    public static get peerNetwork(): number {
        const network = Config.BITCOIN.NETWORK;

        switch (network) {
            case BitcoinNetwork.mainnet:
                return 0;
            case BitcoinNetwork.testnet:
                return 1;
            case BitcoinNetwork.regtest:
                return 2;
            case BitcoinNetwork.signet:
                return 3;
            case BitcoinNetwork.custom:
                return 4;
            default:
                throw new Error(`Invalid bitcoin network: ${network}`);
        }
    }

    public static get magicNumber(): number {
        if (!Config.BITCOIN.NETWORK_MAGIC) {
            throw new Error('Custom network requires network magic');
        }

        if (Config.BITCOIN.NETWORK_MAGIC.length !== 4) {
            throw new Error('Invalid network magic');
        }

        return new Uint32Array(new Uint8Array(Config.BITCOIN.NETWORK_MAGIC.reverse()).buffer)[0];
    }

    public static get hasMagicNumber(): boolean {
        return (
            Config.BITCOIN.NETWORK_MAGIC !== undefined &&
            (Config.BITCOIN.NETWORK_MAGIC ?? []).length === 4
        );
    }

    public static get chainId(): ChainIds {
        return Config.BITCOIN.CHAIN_ID;
    }

    public static numberToBitcoinNetwork(network: number): BitcoinNetwork {
        switch (network) {
            case 0:
                return BitcoinNetwork.mainnet;
            case 1:
                return BitcoinNetwork.testnet;
            case 2:
                return BitcoinNetwork.regtest;
            case 3:
                return BitcoinNetwork.signet;
            case 4:
                return BitcoinNetwork.custom;
            default:
                throw new Error(`Invalid bitcoin network: ${network}`);
        }
    }

    public static getNetworkForBtcOrFractal(): Network {
        switch (Config.BITCOIN.NETWORK) {
            case BitcoinNetwork.mainnet:
                return bitcoin.networks.bitcoin;
            case BitcoinNetwork.testnet:
                return bitcoin.networks.testnet;
            case BitcoinNetwork.regtest:
                return bitcoin.networks.regtest;
            case BitcoinNetwork.signet:
                throw new Error('Signet network not supported');
            case BitcoinNetwork.custom:
                throw new Error('Custom network not supported');
            default:
                throw new Error(`Unsupported network ${Config.BITCOIN.NETWORK}`);
        }
    }

    public static getNetworkForDogecoin(): Network {
        switch (Config.BITCOIN.NETWORK) {
            case BitcoinNetwork.mainnet:
                return bitcoin.networks.dogecoin;
            case BitcoinNetwork.testnet:
                return bitcoin.networks.dogecoinTestnet;
            case BitcoinNetwork.regtest:
                throw new Error('Regtest network not supported');
            case BitcoinNetwork.signet:
                throw new Error('Signet network not supported');
            case BitcoinNetwork.custom:
                throw new Error('Custom network not supported');
            default:
                throw new Error(`Unsupported network ${Config.BITCOIN.NETWORK}`);
        }
    }

    public static getNetworkForLitecoin(): Network {
        switch (Config.BITCOIN.NETWORK) {
            case BitcoinNetwork.mainnet:
                return bitcoin.networks.litecoin;
            case BitcoinNetwork.testnet:
                return bitcoin.networks.litecoinTestnet;
            case BitcoinNetwork.regtest:
                throw new Error('Regtest network not supported');
            case BitcoinNetwork.signet:
                throw new Error('Signet network not supported');
            case BitcoinNetwork.custom:
                throw new Error('Custom network not supported');
            default:
                throw new Error(`Unsupported network ${Config.BITCOIN.NETWORK}`);
        }
    }

    public static getNetwork(): Network {
        switch (Config.BITCOIN.CHAIN_ID) {
            case ChainIds.Bitcoin:
            case ChainIds.Fractal: {
                return this.getNetworkForBtcOrFractal();
            }
            case ChainIds.Dogecoin: {
                return this.getNetworkForDogecoin();
            }
            case ChainIds.Litecoin: {
                return this.getNetworkForLitecoin();
            }
            default: {
                throw new Error(`Unsupported chain id ${Config.BITCOIN.CHAIN_ID}`);
            }
        }
    }
}
