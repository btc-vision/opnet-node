import { ScriptPubKey, VOut } from '@btc-vision/bsi-bitcoin-rpc';
import BigNumber from 'bignumber.js';
import { opcodes, script } from 'bitcoinjs-lib';
import { Decimal128 } from 'mongodb';

export interface ITransactionOutputBase {
    readonly value: Decimal128 | string;
    readonly index: number;
    readonly scriptPubKey: {
        hex: string;
        addresses?: string[];
        address?: string;
    };
}

export interface ITransactionOutput extends ITransactionOutputBase {
    readonly value: Decimal128;

    //pubKeyHash?: Binary;
    //pubKeys?: Binary[];
    //schnorrPubKey?: Binary;
}

export interface APIDocumentOutput extends ITransactionOutputBase {
    readonly value: string;
    //readonly pubKeyHash?: string;
    //readonly pubKeys?: string[];
    //readonly schnorrPubKey?: string;
}

export class TransactionOutput {
    public readonly value: bigint;
    public readonly index: number;

    public readonly scriptPubKey: ScriptPubKey;
    public readonly script: Array<number | Buffer> | null;

    // New properties to hold the decoded public key or hash
    public readonly decodedPubKeyHash: Buffer | null;
    public readonly decodedPublicKeys: Buffer[] | null;
    public readonly decodedSchnorrPublicKey: Buffer | null; // For Taproot

    constructor(data: VOut) {
        this.value = this.convertValue(data.value);
        this.index = data.n;

        this.scriptPubKey = data.scriptPubKey;
        this.script = script.decompile(Buffer.from(this.scriptPubKey.hex, 'hex'));

        // Decode the public key hash or public keys based on the script type
        this.decodedPubKeyHash = this.decodePubKeyHash();
        this.decodedPublicKeys = this.decodePublicKeys();
        this.decodedSchnorrPublicKey = this.decodeSchnorrPublicKey();
    }

    public toDocument(): ITransactionOutput {
        const returnType: ITransactionOutput = {
            value: new Decimal128(this.value.toString()),
            index: this.index,
            scriptPubKey: {
                hex: this.scriptPubKey.hex,
                addresses: this.scriptPubKey.addresses,
                address: this.scriptPubKey.address,
            },
        };

        /*if (this.decodedPubKeyHash) {
            returnType.pubKeyHash = new Binary(this.decodedPubKeyHash);
        }

        if (this.decodedPublicKeys) {
            returnType.pubKeys = this.decodedPublicKeys.map((key) => new Binary(key));
        }

        if (this.decodedSchnorrPublicKey) {
            returnType.schnorrPubKey = new Binary(this.decodedSchnorrPublicKey);
        }*/

        return returnType;
    }

    private decodeSchnorrPublicKey(): Buffer | null {
        if (!this.script) return null;

        // Check for Taproot (P2TR): OP_1 <32-byte Schnorr public key>
        if (
            this.script.length === 2 &&
            this.script[0] === opcodes.OP_1 &&
            Buffer.isBuffer(this.script[1]) &&
            this.script[1].length === 32
        ) {
            return this.script[1]; // Return the Schnorr public key in hex
        }

        return null; // Not a Taproot output
    }

    // for P2PKH or P2WPKH
    private decodePubKeyHash(): Buffer | null {
        if (!this.script) return null;

        // Check for P2PKH: OP_DUP OP_HASH160 <20-byte pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
        if (
            this.script.length === 5 &&
            this.script[0] === opcodes.OP_DUP &&
            this.script[1] === opcodes.OP_HASH160 &&
            Buffer.isBuffer(this.script[2]) &&
            this.script[2].length === 20 &&
            this.script[3] === opcodes.OP_EQUALVERIFY &&
            this.script[4] === opcodes.OP_CHECKSIG
        ) {
            return this.script[2]; // Return the public key hash in hex
        }

        // Check for P2WPKH: OP_0 <20-byte pubKeyHash>
        if (
            this.script.length === 2 &&
            this.script[0] === opcodes.OP_0 &&
            Buffer.isBuffer(this.script[1]) &&
            this.script[1].length === 20
        ) {
            return this.script[1]; // Return the public key hash in hex
        }

        return null; // No public key hash found
    }

    // for P2MS multisig
    private decodePublicKeys(): Buffer[] | null {
        if (!this.script) return null;

        // Check for P2MS (multisig) output: OP_M <pubKey1> <pubKey2> ... <pubKeyN> OP_N OP_CHECKMULTISIG
        if (
            this.script.length >= 4 &&
            this.script[this.script.length - 1] === opcodes.OP_CHECKMULTISIG
        ) {
            const pubKeys: Buffer[] = [];
            for (let i = 1; i < this.script.length - 2; i++) {
                const next = this.script[i];
                if (Buffer.isBuffer(next) && next.length === 33) {
                    pubKeys.push(next); // Add each public key in hex format
                }
            }
            return pubKeys.length > 0 ? pubKeys : null;
        }

        // Check for P2PK (pay-to-pubkey) output: <33-byte pubKey> OP_CHECKSIG
        if (
            this.script.length === 2 &&
            Buffer.isBuffer(this.script[0]) &&
            this.script[0].length === 33 && // Compressed public key
            this.script[1] === opcodes.OP_CHECKSIG
        ) {
            return [this.script[0]]; // Return the public key in hex
        }

        return null; // No public keys found
    }

    private convertValue(value: number): bigint {
        // Safe conversion from decimal float to bigint 8 decimal places
        let bigNumber: BigNumber = new BigNumber(value.toString());
        bigNumber = bigNumber.multipliedBy('100000000').decimalPlaces(0);

        return BigInt(bigNumber.toString());
    }
}
