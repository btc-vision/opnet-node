import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';

export class BitcoinHelper {
    private static ECPair = ECPairFactory(ecc);

    public static generateWallet(): string {
        const keyPair = BitcoinHelper.ECPair.makeRandom();
        const wallet = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey });

        if (!wallet.address) {
            throw new Error('Failed to generate wallet');
        }

        return wallet.address;
    }
}
