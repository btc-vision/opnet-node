import { ScriptSig, VIn } from '@btc-vision/bitcoin-rpc';
import { TransactionInputFlags } from '../../../../poc/configurations/types/IOPNetConsensus.js';
import { OPNetConsensus } from '../../../../poc/configurations/OPNetConsensus.js';

export interface ITransactionInput {
    readonly originalTransactionId: Buffer | undefined;
    readonly outputTransactionIndex: number | undefined; // consumer output index

    readonly scriptSignature?: ScriptSig;
    readonly sequenceId: number;

    readonly transactionInWitness: Buffer[];
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
    readonly txId: Uint8Array | Buffer;
    readonly outputIndex: number;
    readonly scriptSig: Uint8Array | Buffer;
    readonly witnesses: (Uint8Array | Buffer)[];

    readonly flags: number;
    readonly coinbase: Buffer | undefined;
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
    public readonly originalTransactionId: Buffer;
    public readonly outputTransactionIndex: number | undefined; // consumer output index

    public readonly scriptSignature: ScriptSig | undefined;
    public readonly sequenceId: number;

    public readonly transactionInWitness: Buffer[] = [];

    // New properties to hold the decoded public key or hash
    public readonly decodedPubKey: Buffer | null;
    public readonly decodedPubKeyHash: Buffer | null;

    private readonly coinbase: Buffer | undefined = undefined;

    constructor(data: VIn) {
        this.originalTransactionId =
            data.txid && data.txid !== '' ? Buffer.from(data.txid, 'hex') : Buffer.alloc(0);

        this.outputTransactionIndex = data.vout;

        this.scriptSignature = data.scriptSig;
        this.sequenceId = data.sequence;
        this.transactionInWitness = data.txinwitness
            ? data.txinwitness.map((w) => Buffer.from(w, 'hex'))
            : [];

        // for P2PK, P2WPKH, and P2PKH
        this.decodedPubKey = this.decodePubKey();
        this.decodedPubKeyHash = this.decodePubKeyHash();

        // for coinbase
        if (data.coinbase) {
            this.coinbase = Buffer.from(data.coinbase, 'hex');
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
            scriptSig: Buffer.from(this.scriptSignature?.hex || '', 'hex'),
            witnesses: this.transactionInWitness,
            flags: flags,
            coinbase: this.coinbase,
        };
    }

    // Decode public key for P2PK, SegWit (P2WPKH), and P2PKH
    private decodePubKey(): Buffer | null {
        const secondWitnessLength = this.transactionInWitness[1]?.length || 0;

        // Decode from SegWit witness (P2WPKH) or P2PKH
        if (
            this.transactionInWitness.length === 2 &&
            (secondWitnessLength === 66 || secondWitnessLength === 130)
        ) {
            return this.transactionInWitness[1]; // Return the public key in hex format
        }

        // Decode from scriptSig (P2PK)
        if (this.scriptSignature && this.scriptSignature.asm) {
            const parts = this.scriptSignature.asm.split(' ');
            const secondPart = parts[1];

            // Check for P2PK with compressed public key
            if (parts.length === 2 && (secondPart.length === 66 || secondPart.length === 130)) {
                return Buffer.from(secondPart, 'hex'); // Return the public key in hex format
            }
        }

        return null; // No public key found
    }

    // for P2PKH and P2WPKH
    private decodePubKeyHash(): Buffer | null {
        // Check for P2WPKH in witness data
        if (this.transactionInWitness.length === 2 && this.transactionInWitness[0].length === 40) {
            return this.transactionInWitness[0]; // Return the public key hash in hex format
        }

        // Check for P2PKH in scriptSig
        if (this.scriptSignature && this.scriptSignature.asm) {
            const parts = this.scriptSignature.asm.split(' ');
            if (parts.length === 2 && parts[1].length === 40) {
                return Buffer.from(parts[1], 'hex'); // Return the public key hash in hex format
            }
        }

        return null; // No public key hash found
    }
}
