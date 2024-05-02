import bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

bitcoin.initEccLib(ecc);

export class DataValidator {
    public static isValidP2TRAddress(address: string, network: bitcoin.networks.Network): boolean {
        if (!address || address.length < 40) return false;

        let isValidTapRootAddress: boolean = false;
        try {
            bitcoin.address.toOutputScript(address, network);

            const decodedAddress = bitcoin.address.fromBech32(address);
            isValidTapRootAddress = decodedAddress.version === 1;
        } catch (e) {}

        return isValidTapRootAddress;
    }
}
