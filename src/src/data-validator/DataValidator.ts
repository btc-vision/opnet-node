import bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

bitcoin.initEccLib(ecc);

export class DataValidator {
    public static isValidP2TRAddress(address: string, network: bitcoin.networks.Network): boolean {
        if (!address || address.length < 20) return false;

        let isValidTapRootAddress: boolean = false;
        try {
            bitcoin.address.toOutputScript(address, network);

            const decodedAddress = bitcoin.address.fromBech32(address);
            isValidTapRootAddress = decodedAddress.version === 1;
        } catch (e) {}

        return isValidTapRootAddress;
    }

    public static validatePKHAddress(address: string, network: bitcoin.networks.Network): boolean {
        if (!address || address.length < 20) return false;

        let isValidSegWitAddress: boolean = false;
        try {
            // Decode the address using Bech32
            const decodedAddress = bitcoin.address.fromBech32(address);

            // Ensure the decoded address matches the provided network
            bitcoin.address.toOutputScript(address, network);

            // Check if the address is P2WPKH (version 0)
            isValidSegWitAddress =
                decodedAddress.version === 0 && decodedAddress.data.length === 20;
        } catch (e) {}

        return isValidSegWitAddress;
    }
}
