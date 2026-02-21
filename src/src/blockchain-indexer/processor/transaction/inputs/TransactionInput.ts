import { ScriptSig, VIn } from '@btc-vision/bitcoin-rpc';
import { fromHex } from '@btc-vision/bitcoin';
import { TransactionInputFlags } from '../../../../poc/configurations/types/IOPNetConsensus.js';
import { OPNetConsensus } from '../../../../poc/configurations/OPNetConsensus.js';

export interface ITransactionInput {
    readonly originalTransactionId: Uint8Array | undefined;
    readonly outputTransactionIndex: number | undefined; // consumer output index

    readonly scriptSignature?: ScriptSig;
    readonly sequenceId: number;

    readonly transactionInWitness: Uint8Array[];
}

export interface ITransactionInputWithoutWitnesses extends Omit<
    ITransactionInput,
    'transactionInWitness'
> {}

export interface APIDocumentInput extends Omit<
    ITransactionInputWithoutWitnesses,
    'originalTransactionId'
> {
    readonly originalTransactionId: string | undefined;
}

export interface StrippedTransactionInput {
    readonly txId: Uint8Array;
    readonly outputIndex: number;
    readonly scriptSig: Uint8Array;
    readonly witnesses: Uint8Array[];

    readonly flags: number;
    readonly coinbase: Uint8Array | undefined;
}

export interface StrippedTransactionInputAPI {
    readonly txId: string;
    readonly outputIndex: number;
    readonly scriptSig: string;
    readonly witnesses: string[];

    readonly coinbase: string | undefined;
    readonly flags: number;
}

export class TransactionInput implements ITransactionInput {
    public readonly originalTransactionId: Uint8Array;
    public readonly outputTransactionIndex: number | undefined; // consumer output index

    public readonly scriptSignature: ScriptSig | undefined;
    public readonly sequenceId: number;

    public readonly transactionInWitness: Uint8Array[] = [];

    // New properties to hold the decoded public key or hash
    public readonly decodedPubKey: Uint8Array | null;
    public readonly decodedPubKeyHash: Uint8Array | null;

    private readonly coinbase: Uint8Array | undefined = undefined;

    constructor(data: VIn) {
        this.originalTransactionId =
            data.txid && data.txid !== '' ? fromHex(data.txid) : new Uint8Array(0);

        this.outputTransactionIndex = data.vout;

        this.scriptSignature = data.scriptSig;
        this.sequenceId = data.sequence;
        this.transactionInWitness = data.txinwitness ? data.txinwitness.map((w) => fromHex(w)) : [];

        // for P2PK, P2WPKH, and P2PKH
        this.decodedPubKey = this.decodePubKey();
        this.decodedPubKeyHash = this.decodePubKeyHash();

        // for coinbase
        if (data.coinbase) {
            this.coinbase = fromHex(data.coinbase);
        }
    }

    public toDocument(): ITransactionInputWithoutWitnesses {
        return {
            originalTransactionId: this.originalTransactionId,
            outputTransactionIndex: this.outputTransactionIndex,

            scriptSignature: this.scriptSignature?.hex ? this.scriptSignature : undefined,
            sequenceId: this.sequenceId,
        };
    }

    public toStripped(): StrippedTransactionInput {
        let flags: number = 0;

        if (OPNetConsensus.consensus.VM.UTXOS.WRITE_FLAGS) {
            if (OPNetConsensus.consensus.VM.UTXOS.INPUTS.WRITE_COINBASE && this.coinbase) {
                flags |= TransactionInputFlags.hasCoinbase;
            }

            if (
                OPNetConsensus.consensus.VM.UTXOS.INPUTS.WRITE_WITNESSES &&
                this.transactionInWitness &&
                this.transactionInWitness.length
            ) {
                flags |= TransactionInputFlags.hasWitnesses;
            }
        }

        return {
            txId: this.originalTransactionId,
            outputIndex: this.outputTransactionIndex || 0,
            scriptSig: this.scriptSignature?.hex
                ? fromHex(this.scriptSignature.hex)
                : new Uint8Array(0),
            witnesses: this.transactionInWitness,
            flags: flags,
            coinbase: this.coinbase,
        };
    }

    // Decode public key for P2PK, SegWit (P2WPKH), and P2PKH
    private decodePubKey(): Uint8Array | null {
        const secondWitness = this.transactionInWitness[1];
        const secondWitnessLength = secondWitness?.length || 0;

        // Decode from SegWit witness (P2WPKH) or P2PKH
        // Note: witnesses are Uint8Arrays, so we check for byte lengths (33/65), not hex string lengths (66/130)
        if (
            this.transactionInWitness.length === 2 &&
            secondWitness &&
            this.isValidPublicKeyBytes(secondWitness, secondWitnessLength)
        ) {
            return secondWitness; // Return the public key
        }

        // Decode from scriptSig (P2PKH - signature + pubkey)
        if (this.scriptSignature && this.scriptSignature.asm) {
            const parts = this.scriptSignature.asm.split(' ');
            const secondPart = parts[1];

            // Check for P2PKH with compressed (66 hex = 33 bytes) or uncompressed (130 hex = 65 bytes) public key
            if (
                parts.length === 2 &&
                secondPart &&
                (secondPart.length === 66 || secondPart.length === 130)
            ) {
                const pubkeyBytes = fromHex(secondPart);
                // Validate the public key prefix to avoid mistaking scripts for pubkeys
                if (this.isValidPublicKeyBytes(pubkeyBytes, pubkeyBytes.length)) {
                    return pubkeyBytes;
                }
            }
        }

        return null; // No public key found
    }

    // for P2PKH and P2WPKH
    // Note: This method has limited usefulness as P2WPKH witness[0] is a signature, not a pubkey hash.
    // The pubkey hash is in the scriptPubKey of the UTXO being spent, not in the witness.
    private decodePubKeyHash(): Uint8Array | null {
        // Check for P2WPKH in witness data
        if (this.transactionInWitness.length === 2 && this.transactionInWitness[0].length === 20) {
            return this.transactionInWitness[0]; // Return the public key hash
        }

        // Check for P2PKH in scriptSig
        // Note: scriptSig.asm is a string, so length 40 = 20 bytes hex-encoded
        if (this.scriptSignature && this.scriptSignature.asm) {
            const parts = this.scriptSignature.asm.split(' ');
            if (parts.length === 2 && parts[1].length === 40) {
                return fromHex(parts[1]); // Return the public key hash
            }
        }

        return null; // No public key hash found
    }

    // Validate that bytes contain a valid EC public key by checking the prefix byte
    // Compressed keys (33 bytes): must start with 0x02 (even y) or 0x03 (odd y)
    // Uncompressed keys (65 bytes): must start with 0x04
    // This prevents mistaking scripts (like P2WSH witness scripts) for public keys
    private isValidPublicKeyBytes(bytes: Uint8Array, length: number): boolean {
        if (length === 33) {
            // Compressed public key must start with 0x02 or 0x03
            const prefix = bytes[0];
            return prefix === 0x02 || prefix === 0x03;
        } else if (length === 65) {
            // Uncompressed public key must start with 0x04
            return bytes[0] === 0x04;
        }
        return false;
    }
}
