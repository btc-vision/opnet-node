import 'jest';

import { BitcoinRPC } from '../../src/src/blockchain-indexer/rpc/BitcoinRPC.js';
import { BlockchainConfig, BitcoinNetwork } from '@btc-vision/motoswapcommon';

describe('Test', () => {
    test(``, async () => {
        const config: BlockchainConfig = {
            BITCOIND_NETWORK: BitcoinNetwork.TestNet,
            BITCOIND_HOST: "51.81.67.34",
            BITCOIND_PORT: 9237,
            BITCOIND_USERNAME: "HJSiowseujhs",
            BITCOIND_PASSWORD: "YHEFHSDJ23JOIhjjef2ied9u290efu2930u90U"
        };
        const bitcoinRPC: BitcoinRPC = new BitcoinRPC();

        await bitcoinRPC.init(config);

        const block = await bitcoinRPC.getBlockInfoWithTransactionData('00000000000000073609057b145ae82252fe48eaf5dbd7abc2f8715d2586e70d');
        console.log(block.tx[0].vin);
    });
});