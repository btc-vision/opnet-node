import { ScriptPubKey, VOut } from '@btc-vision/bitcoin-rpc';
import BigNumber from 'bignumber.js';
import { opcodes, script } from '@btc-vision/bitcoin';
import { Decimal128 } from 'mongodb';
import { TransactionOutputFlags } from '../../../../poc/configurations/types/IOPNetConsensus.js';
import { OPNetConsensus } from '../../../../poc/configurations/OPNetConsensus.js';

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
}

export interface APIDocumentOutput extends ITransactionOutputBase {
    readonly value: string;
}

export interface StrippedTransactionOutput {
    readonly value: bigint;
    readonly index: number;
    readonly flags: number;
    readonly scriptPubKey: Uint8Array | undefined;
    readonly to: string | undefined;
}

export interface StrippedTransactionOutputAPI {
    readonly value: string;
    readonly index: number;
    readonly to: string | undefined;
    readonly flags: number;
    readonly scriptPubKey: string | undefined;
}

export class TransactionOutput {
    public readonly value: bigint;
    public readonly index: number;

    public readonly scriptPubKey: ScriptPubKey;
    public readonly script: Array<number | Uint8Array> | null;
    public readonly scriptPubKeyBuffer: Buffer;

    // New properties to hold the decoded public key or hash
    public readonly decodedPubKeyHash: Buffer | null;
    public readonly decodedPublicKeys: Buffer[] | null;
    public readonly decodedSchnorrPublicKey: Buffer | null; // For Taproot

    constructor(data: VOut) {
        this.value = this.convertValue(data.value);
        this.index = data.n;

        this.scriptPubKey = data.scriptPubKey;

        this.scriptPubKey.address =
            data.scriptPubKey.address ||
            (Array.isArray(this.scriptPubKey.addresses) && this.scriptPubKey.addresses.length === 1
                ? (this.scriptPubKey.addresses || [])[0]
                : undefined);

        this.scriptPubKeyBuffer = Buffer.from(this.scriptPubKey.hex, 'hex');
        this.script = script.decompile(this.scriptPubKeyBuffer);

        // Decode the public key hash or public keys based on the script type
        this.decodedPubKeyHash = this.decodePubKeyHash();
        this.decodedPublicKeys = this.decodePublicKeys();
        this.decodedSchnorrPublicKey = this.decodeSchnorrPublicKey();
    }

    public toDocument(): ITransactionOutput {
        return {
            value: new Decimal128(this.value.toString()),
            index: this.index,
            scriptPubKey: {
                hex: this.scriptPubKey.hex,
                addresses: this.scriptPubKey.addresses,
                address: this.scriptPubKey.address,
            },
        };
    }

    public toStripped(): StrippedTransactionOutput | null {
        let flags: number = 0;
        if (this.scriptPubKey.address) {
            flags |= TransactionOutputFlags.hasTo;
        }

        if (
            this.scriptPubKeyBuffer &&
            OPNetConsensus.consensus.VM.UTXOS.OUTPUTS.WRITE_SCRIPT_PUB_KEY &&
            !this.scriptPubKey.address
        ) {
            flags |= TransactionOutputFlags.hasScriptPubKey;
        }

        // Handle OP_RETURN
        if (this.scriptPubKey.type === 'nulldata') {
            if (!OPNetConsensus.consensus.VM.UTXOS.OP_RETURN.ENABLED) {
                throw new Error('OP_RETURN is not enabled');
            }

            flags |= TransactionOutputFlags.OP_RETURN;

            // Check if the script is too large
            const scriptSize = this.scriptPubKeyBuffer.length;
            if (scriptSize > OPNetConsensus.consensus.VM.UTXOS.OP_RETURN.MAXIMUM_SIZE) {
                throw new Error(
                    `OP_RETURN script size exceeds maximum size of ${OPNetConsensus.consensus.VM.UTXOS.OP_RETURN.MAXIMUM_SIZE} bytes`,
                );
            }
        }

        return {
            value: this.value,
            index: this.index,
            flags: flags,
            scriptPubKey: this.scriptPubKeyBuffer,
            to: this.scriptPubKey.address,
        };
    }

    private decodeSchnorrPublicKey(): Buffer | null {
        if (!this.script) return null;

        // Check for Taproot (P2TR): OP_1 <32-byte Schnorr public key>
        if (
            this.script.length === 2 &&
            this.script[0] === opcodes.OP_1 &&
            this.script[1] instanceof Uint8Array &&
            this.script[1].length === 32
        ) {
            return Buffer.from(this.script[1]); // Return the Schnorr public key
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
            this.script[2] instanceof Uint8Array &&
            this.script[2].length === 20 &&
            this.script[3] === opcodes.OP_EQUALVERIFY &&
            this.script[4] === opcodes.OP_CHECKSIG
        ) {
            return Buffer.from(this.script[2]); // Return the public key hash
        }

        // Check for P2WPKH: OP_0 <20-byte pubKeyHash>
        if (
            this.script.length === 2 &&
            this.script[0] === opcodes.OP_0 &&
            this.script[1] instanceof Uint8Array &&
            this.script[1].length === 20
        ) {
            return Buffer.from(this.script[1]); // Return the public key hash
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
                if (next instanceof Uint8Array && next.length === 33) {
                    pubKeys.push(Buffer.from(next)); // Add each public key
                }
            }
            return pubKeys.length > 0 ? pubKeys : null;
        }

        // Check for P2PK (pay-to-pubkey) output: <33-byte pubKey> OP_CHECKSIG
        if (
            this.script.length === 2 &&
            this.script[0] instanceof Uint8Array &&
            this.script[0].length === 33 && // Compressed public key
            this.script[1] === opcodes.OP_CHECKSIG
        ) {
            return [Buffer.from(this.script[0])]; // Return the public key
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
