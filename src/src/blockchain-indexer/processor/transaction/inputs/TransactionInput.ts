import { ScriptSig, VIn } from '@btc-vision/bitcoin-rpc';

export interface TransactionInputBase {
    readonly originalTransactionId: Buffer | undefined;
    readonly outputTransactionIndex: number | undefined; // consumer output index

    readonly scriptSignature?: ScriptSig;
    readonly sequenceId: number;

    readonly transactionInWitness: string[];
}

export interface ITransactionInput extends Omit<TransactionInputBase, 'transactionInWitness'> {}

export interface APIDocumentInput extends Omit<ITransactionInput, 'originalTransactionId'> {
    readonly originalTransactionId: string | undefined;
}

export interface StrippedTransactionInput {
    readonly txId: Uint8Array | Buffer;
    readonly outputIndex: number;
    readonly scriptSig: Uint8Array | Buffer;
}

export interface StrippedTransactionInputAPI {
    readonly txId: string;
    readonly outputIndex: number;
    readonly scriptSig: string;
}

export class TransactionInput implements TransactionInputBase {
    public readonly originalTransactionId: Buffer;
    public readonly outputTransactionIndex: number | undefined; // consumer output index

    public readonly scriptSignature: ScriptSig | undefined;
    public readonly sequenceId: number;

    public readonly transactionInWitness: string[] = [];

    // New properties to hold the decoded public key or hash
    public readonly decodedPubKey: Buffer | null;
    public readonly decodedPubKeyHash: Buffer | null;

    constructor(data: VIn) {
        this.originalTransactionId = Buffer.from(data.txid || '', 'hex') || Buffer.alloc(32);
        this.outputTransactionIndex = data.vout;

        this.scriptSignature = data.scriptSig;
        this.sequenceId = data.sequence;
        this.transactionInWitness = data.txinwitness || [];

        // for P2PK, P2WPKH, and P2PKH
        this.decodedPubKey = this.decodePubKey();
        this.decodedPubKeyHash = this.decodePubKeyHash();
    }

    public toDocument(): ITransactionInput {
        return {
            originalTransactionId: this.originalTransactionId,
            outputTransactionIndex: this.outputTransactionIndex,

            scriptSignature: this.scriptSignature?.hex ? this.scriptSignature : undefined,
            sequenceId: this.sequenceId,

            //transactionInWitness: this.transactionInWitness,
        };
    }

    public toStripped(): StrippedTransactionInput {
        return {
            txId: this.originalTransactionId,
            outputIndex: this.outputTransactionIndex || 0,
            scriptSig: Buffer.from(this.scriptSignature?.hex || '', 'hex'),
        };
    }

    // decode public key for P2PK and SegWit (P2WPKH)
    private decodePubKey(): Buffer | null {
        // Decode from SegWit witness (P2WPKH)
        if (this.transactionInWitness.length === 2 && this.transactionInWitness[1].length === 66) {
            return Buffer.from(this.transactionInWitness[1], 'hex'); // Return the public key in hex format
        }

        // Decode from scriptSig (P2PK)
        if (this.scriptSignature && this.scriptSignature.asm) {
            const parts = this.scriptSignature.asm.split(' ');
            if (parts.length === 2 && parts[1].length === 66) {
                return Buffer.from(parts[1], 'hex'); // Return the public key in hex format
            }
        }

        return null; // No public key found
    }

    // for P2PKH and P2WPKH
    private decodePubKeyHash(): Buffer | null {
        // Check for P2WPKH in witness data
        if (this.transactionInWitness.length === 2 && this.transactionInWitness[0].length === 40) {
            return Buffer.from(this.transactionInWitness[0], 'hex'); // Return the public key hash in hex format
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
